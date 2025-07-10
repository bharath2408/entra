import axios, { AxiosResponse } from "axios";
import * as dotenv from "dotenv";

dotenv.config();

interface TokenResponse {
  token_type: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
}

export abstract class GraphServiceBase {
  protected tenantId: string;
  protected clientId: string;
  protected clientSecret: string;
  protected readonly scope: string = "https://graph.microsoft.com/.default";
  protected readonly graphRoot: string = "https://graph.microsoft.com/v1.0/";
  protected token: string | null = null;

  constructor() {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const tenantId = process.env.TENANT_ID;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        " Missing required Microsoft Graph environment variables."
      );
    }

    this.tenantId = tenantId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  protected async getToken(): Promise<string> {
    if (this.token) return this.token;

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

    const data = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });

    const response: AxiosResponse<TokenResponse> = await axios.post(
      tokenUrl,
      data,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    this.token = response.data.access_token;
    return this.token;
  }

  protected getGraphRoot(): string {
    return this.graphRoot;
  }

  protected resetToken(): void {
    this.token = null;
  }

  /**
   * Initializes the token and graph root if not already set.
   */
  protected async initialize(): Promise<void> {
    if (!this.token) {
      this.token = await this.getToken();
    }
  }
}
