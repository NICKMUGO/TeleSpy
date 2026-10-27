using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class OneOpenAllocationPerEmployeeAndSim : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Older allocation code could leave someone holding two lines
            // (or a line with two holders). Before the indexes can exist,
            // each such pile is resolved the way AllocationService would
            // have: the newest open allocation stands, and every older one
            // ends when the next one started. Plain SQL so it runs on both
            // Postgres and SQLite.
            foreach (var column in new[] { "employee_id", "sim_id" })
            {
                var newer = $@"FROM sim_allocations n
                    WHERE n.{column} = sim_allocations.{column} AND n.end_at IS NULL
                      AND (n.start_at > sim_allocations.start_at
                           OR (n.start_at = sim_allocations.start_at AND n.allocation_id > sim_allocations.allocation_id))";
                migrationBuilder.Sql($@"UPDATE sim_allocations
                    SET end_at = (SELECT MIN(n.start_at) {newer})
                    WHERE end_at IS NULL AND EXISTS (SELECT 1 {newer});");
            }

            migrationBuilder.CreateIndex(
                name: "UX_sim_allocations_open_employee",
                table: "sim_allocations",
                column: "employee_id",
                unique: true,
                filter: "end_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "UX_sim_allocations_open_sim",
                table: "sim_allocations",
                column: "sim_id",
                unique: true,
                filter: "end_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_sim_allocations_open_employee",
                table: "sim_allocations");

            migrationBuilder.DropIndex(
                name: "UX_sim_allocations_open_sim",
                table: "sim_allocations");
        }
    }
}
