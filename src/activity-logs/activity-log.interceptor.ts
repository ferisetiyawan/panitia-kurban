import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ActivityLogsService } from './activity-logs.service';

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private readonly activityLogsService: ActivityLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, user, body } = req;

    return next.handle().pipe(
      tap(() => {
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
          if (url.includes('/api/auth/login')) return;

          let details = undefined;
          if (body && Object.keys(body).length > 0) {
            const safeBody = { ...body };
            if (safeBody.password) safeBody.password = '***';
            details = JSON.stringify(safeBody);
          }

          this.activityLogsService.logAction({
            userId: user?.id,
            action: `${method} ${url}`,
            details,
          });
        }
      }),
    );
  }
}
