using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class AddBillingDiscountsAndReconciliation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "list_cost",
                table: "usage_summaries",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "discount_international_pct",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "discount_off_net_off_peak_pct",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 54.0);

            migrationBuilder.AddColumn<double>(
                name: "discount_off_net_peak_pct",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 54.0);

            migrationBuilder.AddColumn<double>(
                name: "discount_on_net_off_peak_pct",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "discount_on_net_peak_pct",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 54.0);

            migrationBuilder.AddColumn<double>(
                name: "excise_rate_pct",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 15.0);

            migrationBuilder.AddColumn<double>(
                name: "fixed_monthly_charge_kes",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 26086.959999999999);

            migrationBuilder.AddColumn<double>(
                name: "vat_rate_pct",
                table: "billing_settings",
                type: "double precision",
                nullable: false,
                defaultValue: 16.0);

            migrationBuilder.CreateTable(
                name: "monthly_invoices",
                columns: table => new
                {
                    month = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    invoice_total_kes = table.Column<double>(type: "double precision", nullable: false),
                    note = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_monthly_invoices", x => x.month);
                });

            // The list rates the app started with (4.87 / 2.50) were the
            // public tariff; the organisation's itemised bill puts the
            // contract's list rates at 4.67 / 2.40 tax-inclusive. Move a
            // row still on the old defaults; leave an Admin's own edit alone.
            migrationBuilder.Sql("UPDATE billing_settings SET peak_rate_kes = 4.67 WHERE peak_rate_kes = 4.87;");
            migrationBuilder.Sql("UPDATE billing_settings SET off_peak_rate_kes = 2.40 WHERE off_peak_rate_kes = 2.5;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "monthly_invoices");

            migrationBuilder.DropColumn(
                name: "list_cost",
                table: "usage_summaries");

            migrationBuilder.DropColumn(
                name: "discount_international_pct",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "discount_off_net_off_peak_pct",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "discount_off_net_peak_pct",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "discount_on_net_off_peak_pct",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "discount_on_net_peak_pct",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "excise_rate_pct",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "fixed_monthly_charge_kes",
                table: "billing_settings");

            migrationBuilder.DropColumn(
                name: "vat_rate_pct",
                table: "billing_settings");
        }
    }
}
