"""Terms & Conditions / Data Protection notice text shown at registration.

Served (not hard-coded into the frontend) so the wording — and the
DPA_KE_POLICY_VERSION it's stamped with — can change without a redeploy,
and so app.py's register endpoint can record exactly which version a user
agreed to.

This is drafted to track the structure the Kenya Data Protection Act, 2019
requires of a data-collection notice: identity of the controller, purpose
of collection, categories of data, legal basis, retention, and the data
subject's rights (access, correction, deletion, objection, complaint to
the ODPC). Have this reviewed by counsel before relying on it in
production — it's a structurally-complete starting point, not legal advice.
"""
from flask import current_app

TERMS_AND_CONDITIONS_TEXT = """
TeleSpy Terms and Conditions

1. TeleSpy is an internal tool for monitoring company-issued SIM cards,
   call activity, and associated telecom cost across departments.
2. Your account and any data you submit may be viewed by authorized staff
   (system administrators, your department manager, and auditors) strictly
   for the purposes of telecom cost management, security, and audit.
3. You are responsible for keeping your password and verification codes
   confidential, and for reporting any suspected unauthorized access.
4. Misuse of the system, including attempting to access data outside your
   role's authorization, may result in account suspension and disciplinary
   action.
""".strip()


def dpa_notice_text() -> str:
    return f"""
Data Protection Notice (Kenya Data Protection Act, 2019)

Data Controller: your employer, operating TeleSpy internally.

What we collect: your name, work email and phone, department, extension
and SIM/MSISDN assignment, and records of calls made/received on company
lines (origin, destination, time, duration, and cost).

Purpose: telecom cost allocation and budgeting, fraud/anomaly detection on
company phone lines, and internal audit — never for purposes unrelated to
your employment.

Legal basis: performance of your employment contract and your employer's
legitimate interest in managing company telecom resources and cost.

Retention: personal and call data is retained for as long as your account
is active and for a reasonable period afterward for audit purposes, then
deleted or anonymized.

Your rights under the Act: you may request access to, correction of, or
deletion of your personal data, object to processing, and lodge a
complaint with the Office of the Data Protection Commissioner (ODPC),
Kenya, if you believe your data has been mishandled.

Policy version: {current_app.config['DPA_KE_POLICY_VERSION']}
""".strip()
