import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

/** Shared app wiring used by main.ts and by integration tests. */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  (app as NestExpressApplication).set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: false });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('PayCore API')
    .setDescription(
      'Multi-currency (PKR/AED/USD) wallet platform. Amounts are decimal strings in major units; ' +
        'responses also include `amountMinor` (integer minor units). Mutating money endpoints require an ' +
        '`Idempotency-Key` header. Every response carries `x-correlation-id`.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}
