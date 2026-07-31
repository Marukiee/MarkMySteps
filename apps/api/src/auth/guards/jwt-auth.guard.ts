import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { JwtPayload } from '../auth.service';
import { ALLOW_PENDING } from '../decorators/allow-pending.decorator';

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Signed by us is not the same as "is an access token".
    //
    // The share links and the video proxy mint their own tokens with the same
    // key, and those carry a scope instead of a subject. Handed in here they
    // verified perfectly well and left `user.sub` undefined — and `undefined`
    // in a Prisma filter is not "matches nobody", it is "no filter at all", so
    // every membership check below would have waved them through to every trip
    // on the server. A share link is given to people outside; this is the line
    // that keeps it a share link.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException('Invalid access token');
    }
    if ('scope' in payload) {
      throw new UnauthorizedException('Invalid access token');
    }
    request.user = payload;

    // An account still waiting for approval carries a token that is valid but
    // powerless. Only a route that says so may accept it — anything else,
    // including anything added later, refuses it.
    if (payload.pending) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException('Your account is waiting for approval');
      }
    }

    return true;
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' ? token : undefined;
}
