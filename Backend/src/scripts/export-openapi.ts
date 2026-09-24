/**
 * Writes the OpenAPI document to Backend/openapi.json without connecting to Postgres or Redis
 * (Nest "preview" mode resolves the module graph but does not instantiate providers).
 * Run after `nest build` so the Swagger CLI plugin metadata is included:
 *
 *   npm run openapi:export
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  const config = new DocumentBuilder().setTitle('PayCore API').setVersion('1.0').addBearerAuth().build();
  const document = SwaggerModule.createDocument(app, config);
  const out = join(__dirname, '..', '..', 'openapi.json');
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI written to ${out} (${Object.keys(document.paths).length} paths)`);
  await app.close();
}

void main();
