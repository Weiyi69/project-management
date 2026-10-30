import "reflect-metadata";
import { resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { config } from "dotenv";
import { AppModule } from "./app.module";

config({ path: resolve(__dirname, "../../../.env") });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: frontendUrl, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle("ORBIT API")
    .setDescription("ORBIT workspace and project management API")
    .setVersion("1.0")
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1");
}

void bootstrap();
