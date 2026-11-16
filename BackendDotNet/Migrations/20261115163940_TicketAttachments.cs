using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class TicketAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ticket_attachments",
                columns: table => new
                {
                    attachment_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    ticket_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    event_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    uploaded_by_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    file_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    content_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_attachments", x => x.attachment_id);
                    table.ForeignKey(
                        name: "FK_ticket_attachments_ticket_events_event_id",
                        column: x => x.event_id,
                        principalTable: "ticket_events",
                        principalColumn: "event_id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ticket_attachments_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "ticket_id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ticket_attachments_users_uploaded_by_user_id",
                        column: x => x.uploaded_by_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ticket_attachments_event_id",
                table: "ticket_attachments",
                column: "event_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ticket_attachments_ticket_id",
                table: "ticket_attachments",
                column: "ticket_id");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_attachments_uploaded_by_user_id",
                table: "ticket_attachments",
                column: "uploaded_by_user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ticket_attachments");
        }
    }
}
