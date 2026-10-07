using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class AddHomeNetworkSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "home_network_name",
                table: "billing_settings",
                type: "character varying(60)",
                maxLength: 60,
                nullable: false,
                defaultValue: "Safaricom");

            migrationBuilder.AddColumn<string>(
                name: "on_net_prefixes",
                table: "billing_settings",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "700-729, 740-743, 745-746, 748, 757-759, 768-769, 790-799, 110-119");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "home_network_name",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "on_net_prefixes",
                table: "billing_settings");
        }
    }
}
