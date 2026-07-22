import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImmichClientService } from './immich-client.service';

/** Connection info safe to return to the client — never includes the key. */
export interface ConnectionStatus {
  serverUrl: string;
  publicUrl: string | null;
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
  async setConnection(
    userId: string,
    serverUrl: string,
    apiKey: string,
    publicUrl?: string,
  ): Promise<ConnectionStatus> {
    const normalizedUrl = serverUrl.replace(/\/+$/, '');
    const normalizedPublicUrl = publicUrl?.replace(/\/+$/, '') ?? null;

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
        publicUrl: normalizedPublicUrl,
        apiKeyEncrypted: this.crypto.encrypt(apiKey),
      },
      update: {
        serverUrl: normalizedUrl,
        publicUrl: normalizedPublicUrl,
        apiKeyEncrypted: this.crypto.encrypt(apiKey),
        lastSyncError: null,
      },
    });

    return this.toStatus(connection, apiKey);
  }

  async getStatus(userId: string): Promise<ConnectionStatus> {
    const connection = await this.prisma.immichConnection.findUnique({ where: { userId } });
    if (!connection) {
      throw new NotFoundException('No Immich connection configured');
    }
    const apiKey = this.crypto.decrypt(connection.apiKeyEncrypted);
    return this.toStatus(connection, apiKey);
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
    connection: {
      serverUrl: string;
      publicUrl: string | null;
      lastSyncAt: Date | null;
      lastSyncError: string | null;
    },
    apiKey: string,
  ): ConnectionStatus {
    return {
      serverUrl: connection.serverUrl,
      publicUrl: connection.publicUrl,
      apiKeyPreview: `${apiKey.slice(0, 4)}…`,
      lastSyncAt: connection.lastSyncAt,
      lastSyncError: connection.lastSyncError,
    };
  }
}
