import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import multer from "multer";
import type { Request, Response } from "express";
import { Observable } from "rxjs";

@Injectable()
export class ProfilePhotoUploadInterceptor implements NestInterceptor {
  private readonly upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  }).single("photo");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    return new Observable((subscriber) => {
      this.upload(request, response, (error?: unknown) => {
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
          subscriber.error(new PayloadTooLargeException("Profile photos must be 5 MB or smaller."));
          return;
        }
        if (error) {
          subscriber.error(new BadRequestException("The profile photo upload is invalid."));
          return;
        }
        next.handle().subscribe(subscriber);
      });
    });
  }
}
