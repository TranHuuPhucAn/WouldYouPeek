
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
                },"players": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string,"key_digest": string | null,"normalized_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id"?: string,"key_digest"?: never,"normalized_key": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string,"key_digest"?: never,"normalized_key"?: string
                  }
                  Relationships: [

                  ]
                },"playlists": {
                  Row: {
                    "created_at": string,"creator_id": string | null,"current_version": string | null,"first_published_at": string | null,"id": string,"is_published": boolean,"kind": string,"published_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"creator_id"?: string | null,"current_version"?: string | null,"first_published_at"?: string | null,"id"?: string,"is_published"?: boolean,"kind": string,"published_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"creator_id"?: string | null,"current_version"?: string | null,"first_published_at"?: string | null,"id"?: string,"is_published"?: boolean,"kind"?: string,"published_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [

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
                    "created_at": string,"creator_id": string | null,"current_version": string | null,"first_published_at": string | null,"id": string,"is_demo": boolean,"is_published": boolean,"published_at": string | null,"sort_order": number,"title": string,"topic": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"creator_id"?: string | null,"current_version"?: string | null,"first_published_at"?: string | null,"id": string,"is_demo"?: boolean,"is_published"?: boolean,"published_at"?: string | null,"sort_order": number,"title": string,"topic": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"creator_id"?: string | null,"current_version"?: string | null,"first_published_at"?: string | null,"id"?: string,"is_demo"?: boolean,"is_published"?: boolean,"published_at"?: string | null,"sort_order"?: number,"title"?: string,"topic"?: string,"updated_at"?: string
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
                    "completed_at": string | null,"created_at": string,"current_index": number | null,"ended_at": string | null,"id": string,"phase": string,"revision": number,"target_kind": string,"target_playlist_id": string | null,"target_playlist_metadata": Json | null,"target_playlist_version_id": string | null,"target_scenario_id": string | null,"target_title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"current_index"?: number | null,"ended_at"?: string | null,"id"?: string,"phase"?: string,"revision"?: number,"target_kind"?: string,"target_playlist_id"?: string | null,"target_playlist_metadata"?: Json | null,"target_playlist_version_id"?: string | null,"target_scenario_id"?: string | null,"target_title"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"current_index"?: number | null,"ended_at"?: string | null,"id"?: string,"phase"?: string,"revision"?: number,"target_kind"?: string,"target_playlist_id"?: string | null,"target_playlist_metadata"?: Json | null,"target_playlist_version_id"?: string | null,"target_scenario_id"?: string | null,"target_title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "training_sessions_target_playlist_id_fkey"
      columns: ["target_playlist_id"]
isOneToOne: false
      referencedRelation: "playlists"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "training_sessions_target_scenario_id_fkey"
      columns: ["target_scenario_id"]
isOneToOne: false
      referencedRelation: "scenarios"
      referencedColumns: ["id"]
    }
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
"authorize_video_playback":
{ Args: { "p_context": Json }; Returns: Json
                           },
"begin_creator_video_delete":
{ Args: { "p_asset_id": string,"p_expected_revision": number,"p_request_id": string }; Returns: Json
                           },
"claim_video_validation":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"complete_creator_video_upload":
{ Args: { "p_asset_id": string,"p_expected_revision": number,"p_request_id": string }; Returns: Json
                           },
"complete_video_validation":
{ Args: { "p_asset_id": string,"p_fence": string,"p_metadata": Json,"p_object_version": string }; Returns: boolean
                           },
"create_creator_playlist":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"create_creator_scenario":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"create_creator_video":
{ Args: { "p_byte_size": number,"p_content_fingerprint": string,"p_file_name": string,"p_mime_type": string,"p_request_id": string }; Returns: Json
                           },
"create_scenario_report":
{ Args: { "p_category": string,"p_detail": string,"p_request_id": string,"p_target": Json }; Returns: Json
                           },
"enable_creator":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"end_training_session":
{ Args: { "p_expected_revision": number,"p_request_id": string,"p_session_id": string }; Returns: Json
                           },
"fail_video_validation":
{ Args: { "p_asset_id": string,"p_code": string,"p_fence": string,"p_retryable": boolean }; Returns: boolean
                           },
"finish_creator_video_delete":
{ Args: { "p_asset_id": string,"p_request_id": string }; Returns: Json
                           },
"finish_creator_video_upload_session":
{ Args: { "p_asset_id": string,"p_fence": string,"p_upload_url": string }; Returns: Json
                           },
"get_active_training_session":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_application_capabilities":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_creator_playlist":
{ Args: { "p_playlist_id": string }; Returns: Json
                           },
"get_creator_playlist_review_preview":
{ Args: { "p_playlist_id": string,"p_revision": number }; Returns: Json
                           },
"get_creator_profile":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_creator_review_preview":
{ Args: { "p_revision": number,"p_scenario_id": string }; Returns: Json
                           },
"get_creator_scenario":
{ Args: { "p_scenario_id": string }; Returns: Json
                           },
"get_creator_video":
{ Args: { "p_asset_id": string }; Returns: Json
                           },
"get_creator_video_request":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"get_creator_video_upload_session":
{ Args: { "p_asset_id": string }; Returns: Json
                           },
"get_library_player":
{ Args: { "p_player_id": string }; Returns: Json
                           },
"get_library_playlist":
{ Args: { "p_playlist_id": string }; Returns: Json
                           },
"get_library_preview":
{ Args: { "p_scenario_id": string }; Returns: Json
                           },
"get_operator_access":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"get_operator_report":
{ Args: { "p_report_id": string }; Returns: Json
                           },
"get_scenario_preview":
{ Args: { "p_scenario_id": string }; Returns: Json
                           },
"get_training_session":
{ Args: { "p_session_id": string }; Returns: Json
                           },
"list_creator_playlist_scenarios":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_query"?: string }; Returns: Json
                           },
"list_creator_playlists":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_status"?: string }; Returns: Json
                           },
"list_creator_scenarios":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_status"?: string }; Returns: Json
                           },
"list_creator_videos":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: Json
                           },
"list_library_players":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_query"?: string }; Returns: Json
                           },
"list_library_playlists":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_player_id"?: string,"p_query"?: string }; Returns: Json
                           },
"list_library_previews":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_player_id"?: string }; Returns: Json
                           },
"list_operator_reports":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_status"?: string }; Returns: Json
                           },
"list_scenario_previews":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_training_sessions":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: Json
                           },
"publish_creator_playlist":
{ Args: { "p_expected_revision": number,"p_playlist_id": string,"p_request_id": string,"p_review_id": string }; Returns: Json
                           },
"publish_creator_scenario":
{ Args: { "p_expected_revision": number,"p_request_id": string,"p_review_id": string,"p_scenario_id": string }; Returns: Json
                           },
"release_creator_video_upload_session":
{ Args: { "p_asset_id": string,"p_fence": string }; Returns: boolean
                           },
"renew_video_validation_lease":
{ Args: { "p_asset_id": string,"p_fence": string }; Returns: boolean
                           },
"report_video_validator_heartbeat":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"resolve_scenario_report":
{ Args: { "p_expected_revision": number,"p_operator_note": string,"p_report_id": string,"p_request_id": string,"p_resolution": string }; Returns: Json
                           },
"retry_creator_video_validation":
{ Args: { "p_asset_id": string,"p_expected_revision": number,"p_request_id": string }; Returns: Json
                           },
"review_creator_playlist":
{ Args: { "p_checklist": Json,"p_expected_revision": number,"p_playlist_id": string,"p_profile_revision": number,"p_request_id": string }; Returns: Json
                           },
"review_creator_scenario":
{ Args: { "p_checklist": Json,"p_expected_revision": number,"p_request_id": string,"p_scenario_id": string }; Returns: Json
                           },
"save_creator_playlist":
{ Args: { "p_content": Json,"p_expected_revision": number,"p_playlist_id": string,"p_request_id": string }; Returns: Json
                           },
"save_creator_profile":
{ Args: { "p_display_name": string,"p_expected_revision": number,"p_request_id": string }; Returns: Json
                           },
"save_creator_scenario":
{ Args: { "p_content": Json,"p_expected_revision": number,"p_request_id": string,"p_scenario_id": string }; Returns: Json
                           },
"set_operator_scenario_visibility":
{ Args: { "p_expected_revision": number,"p_hidden": boolean,"p_reason": string,"p_request_id": string,"p_scenario_id": string }; Returns: Json
                           },
"start_playlist_training_session":
{ Args: { "p_expected_publication_version": string,"p_playlist_id": string,"p_request_id": string }; Returns: Json
                           },
"start_selected_training_session":
{ Args: { "p_request_id": string,"p_target": Json }; Returns: Json
                           },
"start_training_session":
{ Args: { "p_request_id": string }; Returns: Json
                           },
"submit_session_answer":
{ Args: { "p_expected_revision": number,"p_item_id": string,"p_option_id": string,"p_request_id": string,"p_session_id": string }; Returns: Json
                           },
"unpublish_creator_playlist":
{ Args: { "p_expected_revision": number,"p_playlist_id": string,"p_request_id": string }; Returns: Json
                           },
"unpublish_creator_scenario":
{ Args: { "p_expected_revision": number,"p_request_id": string,"p_scenario_id": string }; Returns: Json
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
