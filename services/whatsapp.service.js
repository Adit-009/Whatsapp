/**
 * WhatsApp Service Module
 * Handles communication with Go WhatsMeow Microservice via HTTP/REST.
 * No more silent fallback — errors are surfaced to the UI so the user
 * knows to scan the QR code or start the Go service.
 */

class WhatsAppService {
  constructor() {
    this.baseUrl = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:8080';
  }

  /**
   * Initialize or verify connection status with Go WhatsMeow microservice.
   */
  async initialize() {
    try {
      const isConn = await this.isConnected();
      console.log(`[WhatsAppService] Go WhatsMeow Microservice status: Connected=${isConn}`);
      return isConn;
    } catch (error) {
      console.log('[WhatsAppService] Go WhatsMeow Microservice offline.');
      return false;
    }
  }

  /**
   * Check if WhatsApp service is connected to WhatsApp servers via Go microservice.
   * @returns {Promise<boolean>}
   */
  async isConnected() {
    try {
      const response = await fetch(`${this.baseUrl}/status`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const data = await response.json();
      return !!data.connected;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if the Go microservice process is reachable (even if not authenticated).
   * @returns {Promise<boolean>}
   */
  async isServiceOnline() {
    try {
      const response = await fetch(`${this.baseUrl}/status`, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch latest QR Code base64 image from Go WhatsMeow microservice.
   * @returns {Promise<{connected: boolean, qr: string, serviceOnline: boolean}>}
   */
  async getQRCode() {
    try {
      const response = await fetch(`${this.baseUrl}/qr`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        return { connected: false, qr: '', serviceOnline: true };
      }
      const data = await response.json();
      return { ...data, serviceOnline: true };
    } catch (error) {
      return { connected: false, qr: '', serviceOnline: false };
    }
  }

  /**
   * Send a text message to a specific WhatsApp phone number.
   * Requires the Go WhatsMeow service to be running and authenticated.
   * 
   * @param {string} phone - Recipient phone number in format 91XXXXXXXXXX
   * @param {string} message - Message content
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendMessage(phone, message) {
    // Check if service is online first
    const serviceOnline = await this.isServiceOnline();
    if (!serviceOnline) {
      throw new Error('WhatsApp Go service is not running. Start it with "go run main.go" in the whatsapp-service folder.');
    }

    // Check if authenticated
    const connected = await this.isConnected();
    if (!connected) {
      throw new Error('WhatsApp is not authenticated. Please scan the QR code first using the "Link WhatsApp" button.');
    }

    try {
      const response = await fetch(`${this.baseUrl}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone, message }),
        signal: AbortSignal.timeout(10000)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return {
          success: true,
          messageId: data.message_id,
          timestamp: new Date().toISOString()
        };
      }

      throw new Error(data.error || 'Failed to send message via WhatsMeow.');
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error('Message send timed out. The Go service may be unresponsive.');
      }
      throw error;
    }
  }

  /**
   * Logout WhatsApp session in Go WhatsMeow microservice.
   */
  async logout() {
    try {
      const response = await fetch(`${this.baseUrl}/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return await response.json();
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
const whatsappService = new WhatsAppService();
export default whatsappService;
