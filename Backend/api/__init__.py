"""API layer: one module per domain, each exposing a `RESOURCES` list of
`(Resource, *url_rules)` tuples. `register_resources(api)` wires them all
onto the Flask-RESTful Api in create_app().

Adding a domain = drop in a new `api/<name>.py` with a `RESOURCES` list
and append the module to `_domain_modules()` below.
"""


def _domain_modules():
    from api import (
        analytics,
        audit,
        auth,
        cdr,
        departments,
        employees,
        misc,
        roles,
        settings,
        sims,
        telco_plans,
        tutorial,
    )

    # misc first so "/" and "/health" register ahead of everything else.
    return [
        misc,
        auth,
        settings,
        roles,
        departments,
        employees,
        telco_plans,
        sims,
        cdr,
        analytics,
        audit,
        tutorial,
    ]


def register_resources(api):
    for module in _domain_modules():
        for resource, *url_rules in module.RESOURCES:
            api.add_resource(resource, *url_rules)
