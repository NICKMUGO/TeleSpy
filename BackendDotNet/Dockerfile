# TeleSpy API image. Built by .github/workflows/deploy.yml and pushed to
# GHCR; the server only pulls it (see deploy/docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY TeleSpy.Api.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# Npgsql probes for the Kerberos library on connect; without it every
# start logs a "libgssapi_krb5.so.2" error.
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out .
# Ticket attachments (a volume in production: deploy/docker-compose.yml).
RUN mkdir -p /app/attachments
ENV ASPNETCORE_URLS=http://+:8080 ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
# Apply pending migrations, then serve. --seed / --reencrypt are run by
# hand with `docker compose run --rm api --seed`.
ENTRYPOINT ["sh", "-c", "if [ $# -gt 0 ]; then exec dotnet TeleSpy.Api.dll \"$@\"; fi; dotnet TeleSpy.Api.dll --migrate && exec dotnet TeleSpy.Api.dll", "--"]
