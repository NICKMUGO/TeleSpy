using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class EmployeeRemovalAndUnassignedLineUsage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "removal_reason",
                table: "employees",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "removed_at",
                table: "employees",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "unassigned_line_usage",
                columns: table => new
                {
                    usage_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    extension_code = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    month = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    total_cost = table.Column<double>(type: "double precision", nullable: false),
                    list_cost = table.Column<double>(type: "double precision", nullable: false),
                    calls = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_unassigned_line_usage", x => x.usage_id);
                });

            migrationBuilder.CreateIndex(
                name: "uq_unassigned_line_usage_extension_month",
                table: "unassigned_line_usage",
                columns: new[] { "extension_code", "month" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "unassigned_line_usage");

            migrationBuilder.DropColumn(
                name: "removal_reason",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "removed_at",
                table: "employees");
        }
    }
}
