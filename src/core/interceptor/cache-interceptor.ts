import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpResponse,
  HttpContextToken,
  HttpContext,
} from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap, shareReplay, finalize } from 'rxjs/operators';

export const CACHE_DURATION = new HttpContextToken<number>(() => 0);

@Injectable()
export class CacheInterceptor implements HttpInterceptor {
  private cache = new Map<string, CacheEntry>();
  private pendingRequests = new Map<string, Observable<HttpEvent<any>>>();

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (req.method !== 'GET') {
      return next.handle(req);
    }

    const cacheDuration = req.context.get(CACHE_DURATION);
    
    if (cacheDuration <= 0) {
      return next.handle(req);
    }

    const cacheKey = req.urlWithParams;
    const ttlMiliseconds = cacheDuration * 1000;

    const pendingRequest = this.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const cachedResponse = this.cache.get(cacheKey);
    if (cachedResponse && !this.isExpired(cachedResponse.timestamp, ttlMiliseconds)) {
      return of(cachedResponse.response.clone());
    }

    const request$ = next.handle(req).pipe(
      tap(event => {
        if (event instanceof HttpResponse) {
          this.cache.set(cacheKey, {
            response: event.clone(),
            timestamp: Date.now()
          });
        }
      }),
      shareReplay(1),
      finalize(() => {
        this.pendingRequests.delete(cacheKey);
      })
    );

    this.pendingRequests.set(cacheKey, request$);
    return request$;
  }

  private isExpired(timestamp: number, ttl: number): boolean {
    return Date.now() > timestamp + ttl;
  }
}

interface CacheEntry {
  response: HttpResponse<any>;
  timestamp: number;
}

export function useCache(durationSeconds: number = 60 * 60 * 24): { context: HttpContext } {
  return {
    context: new HttpContext().set(CACHE_DURATION, durationSeconds)
  };
}