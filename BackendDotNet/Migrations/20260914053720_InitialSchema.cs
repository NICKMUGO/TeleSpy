using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeleSpy.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "consents",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    accepted_terms = table.Column<bool>(type: "boolean", nullable: false),
                    accepted_dpa_notice = table.Column<bool>(type: "boolean", nullable: false),
                    dpa_policy_version = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_consents", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "departments",
                columns: table => new
                {
                    department_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    cost_centre_code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    budget_ceiling = table.Column<double>(type: "double precision", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_departments", x => x.department_id);
                });

            migrationBuilder.CreateTable(
                name: "password_reset_tokens",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    expires_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    consumed = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_password_reset_tokens", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roles",
                columns: table => new
                {
                    role_id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    role_name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    permissions = table.Column<string>(type: "text", nullable: false),
                    call_limit_kshs = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_roles", x => x.role_id);
                });

            migrationBuilder.CreateTable(
                name: "telco_plans",
                columns: table => new
                {
                    plan_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    provider = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    plan_id_ref = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    lifecycle_state = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    rate_per_minute_kes = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_telco_plans", x => x.plan_id);
                });

            migrationBuilder.CreateTable(
                name: "tutorial_progress",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    completed_step_ids = table.Column<string>(type: "text", nullable: false),
                    dismissed = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tutorial_progress", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "employees",
                columns: table => new
                {
                    employee_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    department_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    staff_number = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    full_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employees", x => x.employee_id);
                    table.ForeignKey(
                        name: "FK_employees_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "department_id");
                });

            migrationBuilder.CreateTable(
                name: "forecast_results",
                columns: table => new
                {
                    forecast_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    department_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    period = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    forecasted_cost = table.Column<double>(type: "double precision", nullable: true),
                    confidence_low = table.Column<double>(type: "double precision", nullable: true),
                    confidence_high = table.Column<double>(type: "double precision", nullable: true),
                    generated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_forecast_results", x => x.forecast_id);
                    table.ForeignKey(
                        name: "FK_forecast_results_departments_department_id",
                        column: x => x.department_id,
                        principalTable: "departments",
                        principalColumn: "department_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sim_cards",
                columns: table => new
                {
                    sim_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    iccid_enc = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    iccid_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    msisdn_enc = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    msisdn_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    provider = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    plan_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    lifecycle_state = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    msisdn_pbx_enc = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    msisdn_pbx_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sim_cards", x => x.sim_id);
                    table.ForeignKey(
                        name: "FK_sim_cards_telco_plans_plan_id",
                        column: x => x.plan_id,
                        principalTable: "telco_plans",
                        principalColumn: "plan_id");
                });

            migrationBuilder.CreateTable(
                name: "usage_profiles",
                columns: table => new
                {
                    profile_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    employee_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    cluster_label = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_usage_profiles", x => x.profile_id);
                    table.ForeignKey(
                        name: "FK_usage_profiles_employees_employee_id",
                        column: x => x.employee_id,
                        principalTable: "employees",
                        principalColumn: "employee_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "usage_summaries",
                columns: table => new
                {
                    summary_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    employee_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    month = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    total_cost = table.Column<double>(type: "double precision", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_usage_summaries", x => x.summary_id);
                    table.ForeignKey(
                        name: "FK_usage_summaries_employees_employee_id",
                        column: x => x.employee_id,
                        principalTable: "employees",
                        principalColumn: "employee_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    employee_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    email = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    role_id = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    must_change_password = table.Column<bool>(type: "boolean", nullable: false),
                    failed_login_attempts = table.Column<int>(type: "integer", nullable: false),
                    locked_until = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.user_id);
                    table.ForeignKey(
                        name: "FK_users_employees_employee_id",
                        column: x => x.employee_id,
                        principalTable: "employees",
                        principalColumn: "employee_id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_users_roles_role_id",
                        column: x => x.role_id,
                        principalTable: "roles",
                        principalColumn: "role_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sim_allocations",
                columns: table => new
                {
                    allocation_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    sim_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    employee_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    start_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    end_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sim_allocations", x => x.allocation_id);
                    table.ForeignKey(
                        name: "FK_sim_allocations_employees_employee_id",
                        column: x => x.employee_id,
                        principalTable: "employees",
                        principalColumn: "employee_id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_sim_allocations_sim_cards_sim_id",
                        column: x => x.sim_id,
                        principalTable: "sim_cards",
                        principalColumn: "sim_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "audit_logs",
                columns: table => new
                {
                    audit_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    actor_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    action = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    occured_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    actor_role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    resource = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    resource_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    meta = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_logs", x => x.audit_id);
                    table.ForeignKey(
                        name: "FK_audit_logs_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "user_id");
                });

            migrationBuilder.CreateTable(
                name: "password_history",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_password_history", x => x.id);
                    table.ForeignKey(
                        name: "FK_password_history_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "user_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "usage_events",
                columns: table => new
                {
                    event_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    allocation_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    msisdn_pbx = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    destination = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    occured_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    duration_minutes = table.Column<double>(type: "double precision", nullable: false),
                    computed_cost = table.Column<double>(type: "double precision", nullable: false),
                    attribution_state = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    call_classification = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    excluded_from_anomaly_detection = table.Column<bool>(type: "boolean", nullable: false),
                    source_file = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    ingested_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_usage_events", x => x.event_id);
                    table.ForeignKey(
                        name: "FK_usage_events_sim_allocations_allocation_id",
                        column: x => x.allocation_id,
                        principalTable: "sim_allocations",
                        principalColumn: "allocation_id");
                });

            migrationBuilder.CreateTable(
                name: "anomaly_flags",
                columns: table => new
                {
                    flag_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    event_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    anomaly_score = table.Column<double>(type: "double precision", nullable: false),
                    contributing_features = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    resolved_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    resolved_by_user_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_anomaly_flags", x => x.flag_id);
                    table.ForeignKey(
                        name: "FK_anomaly_flags_usage_events_event_id",
                        column: x => x.event_id,
                        principalTable: "usage_events",
                        principalColumn: "event_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_anomaly_flags_event_id",
                table: "anomaly_flags",
                column: "event_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_actor_user_id",
                table: "audit_logs",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_occured_at",
                table: "audit_logs",
                column: "occured_at");

            migrationBuilder.CreateIndex(
                name: "IX_consents_user_id",
                table: "consents",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_departments_cost_centre_code",
                table: "departments",
                column: "cost_centre_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_departments_name",
                table: "departments",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_employees_department_id",
                table: "employees",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_employees_staff_number",
                table: "employees",
                column: "staff_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_forecast_results_department_id",
                table: "forecast_results",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "IX_password_history_user_id",
                table: "password_history",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_password_reset_tokens_token_hash",
                table: "password_reset_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_password_reset_tokens_user_id",
                table: "password_reset_tokens",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_roles_role_name",
                table: "roles",
                column: "role_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sim_allocations_employee_id",
                table: "sim_allocations",
                column: "employee_id");

            migrationBuilder.CreateIndex(
                name: "IX_sim_allocations_sim_id",
                table: "sim_allocations",
                column: "sim_id");

            migrationBuilder.CreateIndex(
                name: "IX_sim_cards_iccid_hash",
                table: "sim_cards",
                column: "iccid_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sim_cards_msisdn_hash",
                table: "sim_cards",
                column: "msisdn_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sim_cards_msisdn_pbx_hash",
                table: "sim_cards",
                column: "msisdn_pbx_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sim_cards_plan_id",
                table: "sim_cards",
                column: "plan_id");

            migrationBuilder.CreateIndex(
                name: "IX_telco_plans_name",
                table: "telco_plans",
                column: "name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tutorial_progress_user_id",
                table: "tutorial_progress",
                column: "user_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_usage_events_allocation_id",
                table: "usage_events",
                column: "allocation_id");

            migrationBuilder.CreateIndex(
                name: "IX_usage_events_call_classification",
                table: "usage_events",
                column: "call_classification");

            migrationBuilder.CreateIndex(
                name: "IX_usage_events_msisdn_pbx",
                table: "usage_events",
                column: "msisdn_pbx");

            migrationBuilder.CreateIndex(
                name: "IX_usage_events_occured_at",
                table: "usage_events",
                column: "occured_at");

            migrationBuilder.CreateIndex(
                name: "IX_usage_profiles_employee_id",
                table: "usage_profiles",
                column: "employee_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_usage_summaries_employee_month",
                table: "usage_summaries",
                columns: new[] { "employee_id", "month" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_email",
                table: "users",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_employee_id",
                table: "users",
                column: "employee_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_role_id",
                table: "users",
                column: "role_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "anomaly_flags");

            migrationBuilder.DropTable(
                name: "audit_logs");

            migrationBuilder.DropTable(
                name: "consents");

            migrationBuilder.DropTable(
                name: "forecast_results");

            migrationBuilder.DropTable(
                name: "password_history");

            migrationBuilder.DropTable(
                name: "password_reset_tokens");

            migrationBuilder.DropTable(
                name: "tutorial_progress");

            migrationBuilder.DropTable(
                name: "usage_profiles");

            migrationBuilder.DropTable(
                name: "usage_summaries");

            migrationBuilder.DropTable(
                name: "usage_events");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "sim_allocations");

            migrationBuilder.DropTable(
                name: "roles");

            migrationBuilder.DropTable(
                name: "employees");

            migrationBuilder.DropTable(
                name: "sim_cards");

            migrationBuilder.DropTable(
                name: "departments");

            migrationBuilder.DropTable(
                name: "telco_plans");
        }
    }
}
