import type { ScraperConfig } from "../types.ts";

export interface FetchResult {
  ok: boolean;
  status: number;
  html?: string;
  error?: string;
}

interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
}

const DELAY_RESET_INTERVAL = 60_000; // Reset delay after 60s of successful requests

export class RateLimitedFetcher {
  private currentDelay: number;
  private config: ScraperConfig;
  private lastRequestTime = 0;
  private lastErrorTime = 0;
  private cookies: Map<string, Cookie> = new Map();
  private lastUrl: string | null = null;

  constructor(config: ScraperConfig) {
    this.config = config;
    this.currentDelay = config.initialDelay;
  }

  private maybeResetDelay(): void {
    // If we've had a full minute without errors, reset to initial delay
    if (this.lastErrorTime > 0 && Date.now() - this.lastErrorTime > DELAY_RESET_INTERVAL) {
      if (this.currentDelay > this.config.initialDelay) {
        console.log(`  No errors for 60s, resetting delay from ${this.currentDelay}ms to ${this.config.initialDelay}ms`);
        this.currentDelay = this.config.initialDelay;
      }
      this.lastErrorTime = 0;
    }
  }

  private parseCookies(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const parts = header.split(";").map((p) => p.trim());
      const [nameValue, ...attributes] = parts;
      const [name, value] = nameValue.split("=", 2);

      if (!name || value === undefined) continue;

      const cookie: Cookie = { name, value };

      for (const attr of attributes) {
        const [attrName, attrValue] = attr.split("=", 2);
        const lowerAttr = attrName.toLowerCase();
        if (lowerAttr === "domain") cookie.domain = attrValue;
        else if (lowerAttr === "path") cookie.path = attrValue;
        else if (lowerAttr === "expires") cookie.expires = new Date(attrValue);
      }

      // Skip expired cookies
      if (cookie.expires && cookie.expires < new Date()) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, cookie);
      }
    }
  }

  private getCookieHeader(): string {
    const now = new Date();
    const validCookies: string[] = [];

    for (const [name, cookie] of this.cookies) {
      if (cookie.expires && cookie.expires < now) {
        this.cookies.delete(name);
        continue;
      }
      validCookies.push(`${cookie.name}=${cookie.value}`);
    }

    return validCookies.join("; ");
  }

  private getReferer(url: string): string {
    // Use last URL as referer, or derive from current URL
    if (this.lastUrl) {
      return this.lastUrl;
    }
    // Fall back to origin as initial referer
    try {
      const parsed = new URL(url);
      return `${parsed.origin}/`;
    } catch {
      return "";
    }
  }

  private async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.currentDelay) {
      await this.wait(this.currentDelay - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private increaseDelay(): void {
    this.currentDelay = Math.min(
      this.currentDelay * this.config.backoffMultiplier,
      this.config.maxDelay
    );
    this.lastErrorTime = Date.now();
    console.log(`  Rate limit hit, increasing delay to ${this.currentDelay}ms`);
  }


  async fetch(url: string, retries = 5): Promise<FetchResult> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      this.maybeResetDelay();
      await this.enforceRateLimit();

      try {
        const cookieHeader = this.getCookieHeader();
        const referer = this.getReferer(url);

        const headers: Record<string, string> = {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": this.lastUrl ? "same-origin" : "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        };

        if (referer) {
          headers["Referer"] = referer;
        }
        if (cookieHeader) {
          headers["Cookie"] = cookieHeader;
        }

        const response = await fetch(url, { headers });

        if (response.status === 429) {
          this.increaseDelay();
          if (attempt < retries) {
            // Wait the full delay before retrying
            const waitTime = this.currentDelay + Math.random() * 2000; // Add jitter
            console.log(`  Rate limited, waiting ${Math.round(waitTime / 1000)}s before retry (attempt ${attempt}/${retries})`);
            await this.wait(waitTime);
            continue;
          }
          return {
            ok: false,
            status: 429,
            error: "Rate limited after all retries",
          };
        }

        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        // Store cookies from response
        const setCookies = response.headers.getSetCookie?.() ?? [];
        if (setCookies.length > 0) {
          this.parseCookies(setCookies);
        }

        // Update referer for next request
        this.lastUrl = url;

        const html = await response.text();
        // Decrease delay on success
        this.currentDelay = Math.max(
          this.currentDelay * 0.85,
          this.config.minDelay
        );

        return {
          ok: true,
          status: response.status,
          html,
        };
      } catch (error) {
        if (attempt < retries) {
          this.increaseDelay();
          const waitTime = this.currentDelay + Math.random() * 2000;
          console.log(`  Network error, waiting ${Math.round(waitTime / 1000)}s before retry (attempt ${attempt}/${retries})`);
          await this.wait(waitTime);
          continue;
        }
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      ok: false,
      status: 0,
      error: "Unknown error",
    };
  }

  async fetchImage(url: string, retries = 5): Promise<{ ok: boolean; data?: Uint8Array; error?: string }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      this.maybeResetDelay();
      await this.enforceRateLimit();

      try {
        const cookieHeader = this.getCookieHeader();
        const referer = this.getReferer(url);

        const headers: Record<string, string> = {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Sec-Fetch-Dest": "image",
          "Sec-Fetch-Mode": "no-cors",
          "Sec-Fetch-Site": "same-origin",
        };

        if (referer) {
          headers["Referer"] = referer;
        }
        if (cookieHeader) {
          headers["Cookie"] = cookieHeader;
        }

        const response = await fetch(url, { headers });

        if (response.status === 429) {
          this.increaseDelay();
          if (attempt < retries) {
            const waitTime = this.currentDelay + Math.random() * 2000;
            console.log(`  Image rate limited, waiting ${Math.round(waitTime / 1000)}s before retry (attempt ${attempt}/${retries})`);
            await this.wait(waitTime);
            continue;
          }
          return {
            ok: false,
            error: "Rate limited after all retries",
          };
        }

        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        // Store cookies from response
        const setCookies = response.headers.getSetCookie?.() ?? [];
        if (setCookies.length > 0) {
          this.parseCookies(setCookies);
        }

        const buffer = await response.arrayBuffer();
        // Decrease delay on success
        this.currentDelay = Math.max(
          this.currentDelay * 0.85,
          this.config.minDelay
        );

        return {
          ok: true,
          data: new Uint8Array(buffer),
        };
      } catch (error) {
        if (attempt < retries) {
          this.increaseDelay();
          const waitTime = this.currentDelay + Math.random() * 2000;
          console.log(`  Image network error, waiting ${Math.round(waitTime / 1000)}s before retry (attempt ${attempt}/${retries})`);
          await this.wait(waitTime);
          continue;
        }
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      ok: false,
      error: "Unknown error",
    };
  }

  getCurrentDelay(): number {
    return this.currentDelay;
  }
}
