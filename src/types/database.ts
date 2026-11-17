
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "attempts": {
                  Row: {
                    "answer": NonNullable<Json>,"answer_schema_version": number,"answered_at": string,"id": string,"item_id": string,"option_id": string,"session_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": NonNullable<Json>,"answer_schema_version"?: number,"answered_at"?: string,"id"?: string,"item_id": string,"option_id": string,"session_id": string,"user_id": string
                  }
                  Update: {
                    "answer"?: NonNullable<Json>,"answer_schema_version"?: number,"answered_at"?: string,"id"?: string,"item_id"?: string,"option_id"?: string,"session_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attempts_item_id_session_id_user_id_fkey"
      columns: ["item_id","session_id","user_id"]
isOneToOne: false
      referencedRelation: "training_session_items"
      referencedColumns: ["id","session_id","user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"creator_enabled_at": string | null,"email_verified_at": string | null,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"creator_enabled_at"?: string | null,"email_verified_at"?: string | null,"role"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"creator_enabled_at"?: string | null,"email_verified_at"?: string | null,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"scenario_versions": {
                  Row: {
                    "challenge": NonNullable<Json>,"checksum": string,"content_version": string,"created_at": string,"id": string,"scenario_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "challenge": NonNullable<Json>,"checksum": string,"content_version": string,"created_at"?: string,"id": string,"scenario_id": string
                  }
                  Update: {
                    "challenge"?: NonNullable<Json>,"checksum"?: string,"content_version"?: string,"created_at"?: string,"id"?: string,"scenario_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scenario_versions_scenario_id_fkey"
      columns: ["scenario_id"]
isOneToOne: false
      referencedRelation: "scenarios"
      referencedColumns: ["id"]
    }
                  ]
                },"scenarios": {
                  Row: {
                    "current_version": string | null,"id": string,"is_demo": boolean,"is_published": boolean,"sort_order": number,"title": string,"topic": string
                  }
                  ComputedFields: never
                  Insert: {
                    "current_version"?: string | null,"id": string,"is_demo"?: boolean,"is_published"?: boolean,"sort_order": number,"title": string,"topic": string
                  }
                  Update: {
                    "current_version"?: string | null,"id"?: string,"is_demo"?: boolean,"is_published"?: boolean,"sort_order"?: number,"title"?: string,"topic"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "current_version_belongs_to_scenario"
      columns: ["current_version","id"]
isOneToOne: false
      referencedRelation: "scenario_versions"
      referencedColumns: ["id","scenario_id"]
    }
                  ]
                },"training_session_items": {
                  Row: {
                    "id": string,"position": number,"scenario_version_id": string,"session_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"position": number,"scenario_version_id": string,"session_id": string,"user_id": string
                  }
                  Update: {
                    "id"?: string,"position"?: number,"scenario_version_id"?: string,"session_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "training_session_items_scenario_version_id_fkey"
      columns: ["scenario_version_id"]
isOneToOne: false
      referencedRelation: "scenario_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "training_session_items_session_id_user_id_fkey"
      columns: ["session_id","user_id"]
isOneToOne: false
      referencedRelation: "training_sessions"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"training_sessions": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"current_index": number | null,"id": string,"phase": string,"revision": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"current_index"?: number | null,"id"?: string,"phase"?: string,"revision"?: number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"current_index"?: number | null,"id"?: string,"phase"?: string,"revision"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "advance_training_session":
{ Args: { "p_expected_revision": number,"p_from_item_id": string,"p_request_id": string,"p_session_id": string }; Returns: Json
                           },
"enable_creator":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_scenario_preview":
{ Args: { "p_scenario_id": string }; Returns: Json
                           },
"get_training_session":
{ Args: { "p_session_id": string }; Returns: Json
                           },
"list_scenario_previews":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_training_sessions":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: Json
                           },
"start_training_session":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"submit_session_answer":
{ Args: { "p_expected_revision": number,"p_item_id": string,"p_option_id": string,"p_request_id": string,"p_session_id": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
