using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyNumberPrefix : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "company_number_prefix",
                table: "billing_settings",
                type: "character varying(9)",
                maxLength: 9,
                nullable: false,
                defaultValue: "0703083");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "company_number_prefix",
                table: "billing_settings");
        }
    }
}
