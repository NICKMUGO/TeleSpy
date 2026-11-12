using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class TicketForwards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ticket_forwards",
                columns: table => new
                {
                    forward_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    ticket_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    from_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    to_department_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    to_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    message = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    reply_note = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    replied_by_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    replied_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_forwards", x => x.forward_id);
                    table.ForeignKey(
                        name: "FK_ticket_forwards_departments_to_department_id",
                        column: x => x.to_department_id,
                        principalTable: "departments",
                        principalColumn: "department_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ticket_forwards_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "ticket_id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ticket_forwards_users_from_user_id",
                        column: x => x.from_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ticket_forwards_users_replied_by_user_id",
                        column: x => x.replied_by_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ticket_forwards_users_to_user_id",
                        column: x => x.to_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ticket_forwards_from_user_id",
                table: "ticket_forwards",
                column: "from_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_forwards_replied_by_user_id",
                table: "ticket_forwards",
                column: "replied_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_forwards_ticket_id",
                table: "ticket_forwards",
                column: "ticket_id");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_forwards_to_department_id_status",
                table: "ticket_forwards",
                columns: new[] { "to_department_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_ticket_forwards_to_user_id_status",
                table: "ticket_forwards",
                columns: new[] { "to_user_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ticket_forwards");
        }
    }
}
