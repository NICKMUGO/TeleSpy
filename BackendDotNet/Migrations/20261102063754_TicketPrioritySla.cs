using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class TicketPrioritySla : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "due_at",
                table: "tickets",
                type: "timestamp without time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "priority",
                table: "tickets",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "medium");

            // Tickets raised before priorities existed count as medium, due
            // the default 24 hours after they were raised.
            migrationBuilder.Sql("UPDATE tickets SET due_at = created_at + interval '24 hours';");

            migrationBuilder.AddColumn<int>(
                name: "sla_high_hours",
                table: "billing_settings",
                type: "integer",
                nullable: false,
                defaultValue: 4);

            migrationBuilder.AddColumn<int>(
                name: "sla_low_hours",
                table: "billing_settings",
                type: "integer",
                nullable: false,
                defaultValue: 72);

            migrationBuilder.AddColumn<int>(
                name: "sla_medium_hours",
                table: "billing_settings",
                type: "integer",
                nullable: false,
                defaultValue: 24);

            migrationBuilder.CreateIndex(
                name: "IX_tickets_due_at",
                table: "tickets",
                column: "due_at");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_resolved_at",
                table: "tickets",
                column: "resolved_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_tickets_due_at",
                table: "tickets");

            migrationBuilder.DropIndex(
                name: "IX_tickets_resolved_at",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "due_at",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "priority",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "sla_high_hours",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "sla_low_hours",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "sla_medium_hours",
                table: "billing_settings");
        }
    }
}
