import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: 'http://localhost:5173' }); // Vite dev server
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`HOI4 Dashboard server running on http://localhost:${port}`);
}
bootstrap();
