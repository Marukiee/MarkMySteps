import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImmichClientService } from './immich-client.service';

/** Connection info safe to return to the client — never includes the key. */
export interface ConnectionStatus {
  serverUrl: string;
  apiKeyPreview: string; // e.g. "hZk3…"
  lastSyncAt: Date | null;
  lastSyncError: string | null;
}

/** Decrypted credentials for internal use only. Never serialize this. */
export interface ImmichCredentials {
  serverUrl: string;
  apiKey: string;
}

@Injectable()
export class ImmichConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly client: ImmichClientService,
  ) {}

  /** Validates against the Immich server, then stores the key encrypted. */
  async setConnection(userId: string, serverUrl: string, apiKey: string): Promise<ConnectionStatus> {
    const normalizedUrl = serverUrl.replace(/\/+$/, '');

    try {
      await this.client.ping(normalizedUrl, apiKey);
    } catch {
      throw new BadRequestException(
        'Could not authenticate with the Immich server — check the URL and API key',
      );
    }

    const connection = await this.prisma.immichConnection.upsert({
      where: { userId },
      create: {
        userId,
        serverUrl: normalizedUrl,
        apiKeyEncrypted: this.crypto.encrypt(apiKey),
      },
      update: {
        serverUrl: normalizedUrl,
        apiKeyEncrypted: this.crypto.encrypt(apiKey),
        lastSyncError: null,
      },
    });

    return this.toStatus(connection.serverUrl, apiKey, connection.lastSyncAt, null);
  }

  async getStatus(userId: string): Promise<ConnectionStatus> {
    const connection = await this.prisma.immichConnection.findUnique({ where: { userId } });
    if (!connection) {
      throw new NotFoundException('No Immich connection configured');
    }
    const apiKey = this.crypto.decrypt(connection.apiKeyEncrypted);
    return this.toStatus(
      connection.serverUrl,
      apiKey,
      connection.lastSyncAt,
      connection.lastSyncError,
    );
  }

  async removeConnection(userId: string): Promise<void> {
    await this.prisma.immichConnection.deleteMany({ where: { userId } });
  }

  /** Internal: decrypted credentials for sync / thumbnail proxying. */
  async getCredentials(userId: string): Promise<ImmichCredentials | null> {
    const connection = await this.prisma.immichConnection.findUnique({ where: { userId } });
    if (!connection) return null;
    return {
      serverUrl: connection.serverUrl,
      apiKey: this.crypto.decrypt(connection.apiKeyEncrypted),
    };
  }

  async recordSyncResult(userId: string, error: string | null): Promise<void> {
    await this.prisma.immichConnection.updateMany({
      where: { userId },
      data: { lastSyncAt: new Date(), lastSyncError: error },
    });
  }

  private toStatus(
    serverUrl: string,
    apiKey: string,
    lastSyncAt: Date | null,
    lastSyncError: string | null,
  ): ConnectionStatus {
    return {
      serverUrl,
      apiKeyPreview: `${apiKey.slice(0, 4)}…`,
      lastSyncAt,
      lastSyncError,
    };
  }
}
