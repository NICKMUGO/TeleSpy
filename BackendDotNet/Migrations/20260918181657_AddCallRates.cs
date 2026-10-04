using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class AddCallRates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "billing_settings",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    peak_rate_kes = table.Column<double>(type: "double precision", nullable: false),
                    off_peak_rate_kes = table.Column<double>(type: "double precision", nullable: false),
                    peak_start_hour = table.Column<int>(type: "integer", nullable: false),
                    peak_end_hour = table.Column<int>(type: "integer", nullable: false),
                    default_international_rate_kes = table.Column<double>(type: "double precision", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_settings", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "international_call_rates",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    country_code = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: false),
                    country_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    rate_kes_per_minute = table.Column<double>(type: "double precision", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_international_call_rates", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_international_call_rates_country_code",
                table: "international_call_rates",
                column: "country_code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "billing_settings");

            migrationBuilder.DropTable(
                name: "international_call_rates");
        }
    }
}
