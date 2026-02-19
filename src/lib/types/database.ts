export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone: string;
          email: string | null;
          name: string | null;
          wallet_address: string | null;
          privy_user_id: string | null;
          phone_verified_at: string | null;
          email_verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          email?: string | null;
          name?: string | null;
          wallet_address?: string | null;
          privy_user_id?: string | null;
          phone_verified_at?: string | null;
          email_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          email?: string | null;
          name?: string | null;
          wallet_address?: string | null;
          privy_user_id?: string | null;
          phone_verified_at?: string | null;
          email_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      deals: {
        Row: {
          id: string;
          short_code: string;
          status: string;
          seller_id: string;
          buyer_id: string | null;
          event_name: string;
          event_date: string | null;
          venue: string | null;
          section: string | null;
          row: string | null;
          seats: string | null;
          num_tickets: number;
          price_cents: number;
          transfer_method: string | null;
          terms: Json | null;
          escrow_tx_hash: string | null;
          chat_mode: string;
          locked_at: string | null;
          funded_at: string | null;
          transferred_at: string | null;
          confirmed_at: string | null;
          disputed_at: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          short_code: string;
          status?: string;
          seller_id: string;
          buyer_id?: string | null;
          event_name: string;
          event_date?: string | null;
          venue?: string | null;
          section?: string | null;
          row?: string | null;
          seats?: string | null;
          num_tickets: number;
          price_cents: number;
          transfer_method?: string | null;
          terms?: Json | null;
          escrow_tx_hash?: string | null;
          chat_mode?: string;
          locked_at?: string | null;
          funded_at?: string | null;
          transferred_at?: string | null;
          confirmed_at?: string | null;
          disputed_at?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          short_code?: string;
          status?: string;
          seller_id?: string;
          buyer_id?: string | null;
          event_name?: string;
          event_date?: string | null;
          venue?: string | null;
          section?: string | null;
          row?: string | null;
          seats?: string | null;
          num_tickets?: number;
          price_cents?: number;
          transfer_method?: string | null;
          terms?: Json | null;
          escrow_tx_hash?: string | null;
          chat_mode?: string;
          locked_at?: string | null;
          funded_at?: string | null;
          transferred_at?: string | null;
          confirmed_at?: string | null;
          disputed_at?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          deal_id: string;
          sender_id: string | null;
          conversation_id: string | null;
          role: string;
          channel: string;
          visibility: string;
          content: string;
          media_urls: string[] | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          sender_id?: string | null;
          conversation_id?: string | null;
          role: string;
          channel?: string;
          visibility?: string;
          content: string;
          media_urls?: string[] | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          sender_id?: string | null;
          conversation_id?: string | null;
          role?: string;
          channel?: string;
          visibility?: string;
          content?: string;
          media_urls?: string[] | null;
          metadata?: Json | null;
          created_at?: string;
        };
      };
      conversations: {
        Row: {
          id: string;
          deal_id: string;
          buyer_id: string;
          status: string;
          negotiated_price_cents: number | null;
          last_message_preview: string | null;
          last_message_at: string | null;
          message_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          buyer_id: string;
          status?: string;
          negotiated_price_cents?: number | null;
          last_message_preview?: string | null;
          last_message_at?: string | null;
          message_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          buyer_id?: string;
          status?: string;
          negotiated_price_cents?: number | null;
          last_message_preview?: string | null;
          last_message_at?: string | null;
          message_count?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      deal_events: {
        Row: {
          id: string;
          deal_id: string;
          event_type: string;
          actor_id: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          event_type: string;
          actor_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          event_type?: string;
          actor_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
      };
    };
  };
}

// Convenience types
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Deal = Database["public"]["Tables"]["deals"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
export type DealEvent = Database["public"]["Tables"]["deal_events"]["Row"];
