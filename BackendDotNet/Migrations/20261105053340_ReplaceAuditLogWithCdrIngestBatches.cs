using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceAuditLogWithCdrIngestBatches : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "cdr_ingest_batches",
                columns: table => new
                {
                    batch_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    uploaded_by_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    uploaded_by_role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    source_file = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    ingested = table.Column<int>(type: "integer", nullable: false),
                    attributed = table.Column<int>(type: "integer", nullable: false),
                    unattributed = table.Column<int>(type: "integer", nullable: false),
                    skipped_unanswered = table.Column<int>(type: "integer", nullable: false),
                    lines_created = table.Column<int>(type: "integer", nullable: false),
                    occured_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cdr_ingest_batches", x => x.batch_id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_cdr_ingest_batches_occured_at",
                table: "cdr_ingest_batches",
                column: "occured_at");

            // Keep the upload history: every cdr_ingested audit row becomes a
            // batch row, then the rest of the audit trail is dropped.
            migrationBuilder.Sql("""
                INSERT INTO cdr_ingest_batches
                    (batch_id, uploaded_by_user_id, uploaded_by_role, source_file, ingested, attributed,
                     unattributed, skipped_unanswered, lines_created, occured_at)
                SELECT audit_id, actor_user_id, actor_role, left(m->>'source_file', 255),
                       COALESCE((m->>'ingested')::int, 0), COALESCE((m->>'attributed')::int, 0),
                       COALESCE((m->>'unattributed')::int, 0), COALESCE((m->>'skipped_unanswered')::int, 0),
                       CASE WHEN jsonb_typeof(m->'lines_created') = 'array' THEN jsonb_array_length(m->'lines_created') ELSE 0 END,
                       occured_at
                FROM (SELECT audit_id, actor_user_id, actor_role, occured_at, meta::jsonb AS m
                      FROM audit_logs WHERE action = 'cdr_ingested') AS a;
                """);

            migrationBuilder.DropTable(
                name: "audit_logs");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "cdr_ingest_batches");

            migrationBuilder.CreateTable(
                name: "audit_logs",
                columns: table => new
                {
                    audit_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    actor_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    action = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    actor_role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    meta = table.Column<string>(type: "text", nullable: false),
                    occured_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    resource = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    resource_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_logs", x => x.audit_id);
                    table.ForeignKey(
                        name: "FK_audit_logs_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "user_id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_actor_user_id",
                table: "audit_logs",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_occured_at",
                table: "audit_logs",
                column: "occured_at");
        }
    }
}
