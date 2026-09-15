using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class AddExtensionCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "extension_code",
                table: "usage_summaries",
                type: "character varying(3)",
                maxLength: 3,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "extension_code",
                table: "employees",
                type: "character varying(3)",
                maxLength: 3,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_employees_extension_code",
                table: "employees",
                column: "extension_code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_employees_extension_code",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "extension_code",
                table: "usage_summaries");

            migrationBuilder.DropColumn(
                name: "extension_code",
                table: "employees");
        }
    }
}
