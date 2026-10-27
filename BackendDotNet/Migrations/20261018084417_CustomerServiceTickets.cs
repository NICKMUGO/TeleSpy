using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class CustomerServiceTickets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "handles_customer_service",
                table: "departments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "ticket_categories",
                columns: table => new
                {
                    category_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    department_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_categories", x => x.category_id);
                    table.ForeignKey(
                        name: "FK_ticket_categories_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "department_id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "tickets",
                columns: table => new
                {
                    ticket_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    subject = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    customer_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    customer_phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    customer_email = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    booking_reference = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    category_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    department_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    raised_by_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    claimed_by_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    claimed_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    resolved_by_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    resolved_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    resolution_note = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    return_count = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tickets", x => x.ticket_id);
                    table.ForeignKey(
                        name: "FK_tickets_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "department_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tickets_ticket_categories_category_id",
                        column: x => x.category_id,
                        principalTable: "ticket_categories",
                        principalColumn: "category_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tickets_users_claimed_by_user_id",
                        column: x => x.claimed_by_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tickets_users_raised_by_user_id",
                        column: x => x.raised_by_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tickets_users_resolved_by_user_id",
                        column: x => x.resolved_by_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ticket_events",
                columns: table => new
                {
                    event_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    ticket_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    actor_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    body = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_events", x => x.event_id);
                    table.ForeignKey(
                        name: "FK_ticket_events_tickets_ticket_id",
                        column: x => x.ticket_id,
                        principalTable: "tickets",
                        principalColumn: "ticket_id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ticket_events_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ticket_categories_department_id",
                table: "ticket_categories",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_categories_name",
                table: "ticket_categories",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ticket_events_actor_user_id",
                table: "ticket_events",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_events_ticket_id",
                table: "ticket_events",
                column: "ticket_id");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_category_id",
                table: "tickets",
                column: "category_id");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_claimed_by_user_id",
                table: "tickets",
                column: "claimed_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_department_id_status",
                table: "tickets",
                columns: new[] { "department_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_tickets_number",
                table: "tickets",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tickets_raised_by_user_id",
                table: "tickets",
                column: "raised_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_resolved_by_user_id",
                table: "tickets",
                column: "resolved_by_user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ticket_events");

            migrationBuilder.DropTable(
                name: "tickets");

            migrationBuilder.DropTable(
                name: "ticket_categories");

            migrationBuilder.DropColumn(
                name: "handles_customer_service",
                table: "departments");
        }
    }
}
