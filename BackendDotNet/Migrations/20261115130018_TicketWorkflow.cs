using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class TicketWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "close_note",
                table: "tickets",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "closed_at",
                table: "tickets",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "closed_by_user_id",
                table: "tickets",
                type: "character varying(36)",
                maxLength: 36,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "escalated_at",
                table: "tickets",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "paused_at",
                table: "tickets",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "reopen_count",
                table: "tickets",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "due_at",
                table: "ticket_forwards",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "escalated_at",
                table: "ticket_forwards",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "actor_user_id",
                table: "ticket_events",
                type: "character varying(36)",
                maxLength: 36,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(36)",
                oldMaxLength: 36);

            migrationBuilder.CreateIndex(
                name: "IX_tickets_closed_by_user_id",
                table: "tickets",
                column: "closed_by_user_id");

            migrationBuilder.AddForeignKey(
                name: "FK_tickets_users_closed_by_user_id",
                table: "tickets",
                column: "closed_by_user_id",
                principalTable: "users",
                principalColumn: "user_id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tickets_users_closed_by_user_id",
                table: "tickets");

            migrationBuilder.DropIndex(
                name: "IX_tickets_closed_by_user_id",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "close_note",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "closed_at",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "closed_by_user_id",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "escalated_at",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "paused_at",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "reopen_count",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "due_at",
                table: "ticket_forwards");

            migrationBuilder.DropColumn(
                name: "escalated_at",
                table: "ticket_forwards");

            migrationBuilder.AlterColumn<string>(
                name: "actor_user_id",
                table: "ticket_events",
                type: "character varying(36)",
                maxLength: 36,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(36)",
                oldMaxLength: 36,
                oldNullable: true);
        }
    }
}
