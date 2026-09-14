import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule, bootConfig } from './app.module.js';

/**
 * Process bootstrap.
 *
 * Nothing here is module-aware. Every concern below is genuinely global:
 * security headers, CORS, versioned prefix, OpenAPI, graceful shutdown.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('main');

  const app = await NestFactory.create(AppModule, {
    // Order our own logger by config rather than Nest's defaults.
    logger:
      bootConfig.LOG_LEVEL === 'debug'
        ? ['error', 'warn', 'log', 'debug', 'verbose']
        : ['error', 'warn', 'log'],
    // We do our own body parsing limits below.
    bodyParser: true,
  });

  app.use(helmet({ contentSecurityPolicy: bootConfig.NODE_ENV === 'production' }));

  app.enableCors({
    origin: bootConfig.CORS_ORIGINS,
    credentials: true,
    // The tenant header must survive CORS or multi-tenancy breaks in browsers.
    allowedHeaders: ['content-type', 'authorization', 'x-reef-technologies-tenant', 'x-trace-id'],
    exposedHeaders: ['x-trace-id'],
  });

  app.setGlobalPrefix(bootConfig.API_PREFIX);

  // No global ValidationPipe: that one is class-validator based, and this
  // platform validates with Zod (`zodBody(schema)` per route), so the schema
  // is shared verbatim with the frontend and exported to the Python worker.
  // Parameter pipes such as ParseUUIDPipe still work without it.

  // Lets Nest's OnApplicationShutdown hooks run: drain the pool, quit Redis,
  // stop the consumer loop. Without this, a rolling deploy drops in-flight
  // work and leaves un-ACKed stream entries behind.
  app.enableShutdownHooks();

  // OpenAPI in every environment except production — the contract is a
  // deliverable for the frontend and the SDK generator, not a debug tool.
  if (bootConfig.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Reef Technologies Platform API')
        .setDescription(
          'Modular monolith. Endpoints appear only for modules enabled in this deployment — ' +
            'GET /_platform/capabilities for the live list.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .addGlobalParameters({
          name: 'x-reef-technologies-tenant',
          in: 'header',
          required: false,
          description: 'Overrides host-based tenant resolution.',
        })
        .build(),
    );
    SwaggerModule.setup(`${bootConfig.API_PREFIX}/docs`, app, document, {
      jsonDocumentUrl: `${bootConfig.API_PREFIX}/docs/openapi.json`,
    });
    logger.log(`OpenAPI at /${bootConfig.API_PREFIX}/docs`);
  }

  await app.listen(bootConfig.PORT, '0.0.0.0');
  logger.log(`${bootConfig.APP_NAME} listening on :${bootConfig.PORT}/${bootConfig.API_PREFIX}`);
}

void bootstrap().catch((error: unknown) => {
  // Boot failures are fatal by design: a bad module graph or missing config
  // must stop the container, not degrade into a half-running service.
  console.error('\n✗ Reef Technologies API failed to start\n');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
