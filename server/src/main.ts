import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpSecurity } from './http-security';
import { configureAnalyzeRequestProfiling } from './analyze-request-profile';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureAnalyzeRequestProfiling(app);
  configureHttpSecurity(app);
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`HOI4 Dashboard server listening on 0.0.0.0:${port}`);
}
void bootstrap();
