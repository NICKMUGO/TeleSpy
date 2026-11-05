#!/usr/bin/env bash
# Creates the TeleSpy server on an Azure for Students subscription: one
# Standard_B2ats_v2 Ubuntu VM (2 vCPU, 1 GB; one of the free-tier sizes,
# 750 hours/month for 12 months) on a 64 GB P6 SSD (also in the free
# allowance), with a public DNS name and
# only ports 22, 80 and 443 open. cloud-init.yml installs Docker on first
# boot. Run once, from your own machine:
#
#     az login
#     ./deploy/azure-provision.sh
#
# Override any default with an environment variable, e.g.
#     LOCATION=italynorth VM_SIZE=Standard_B1s ./deploy/azure-provision.sh
#
# Azure for Students only allows some regions (for this subscription:
# centralindia, uaenorth, austriaeast, switzerlandnorth, italynorth), and a
# free size can be out of capacity in one ("SkuNotAvailable": UAE North had
# neither B1s nor B2ats_v2 on 2026-11-05). Try another region or
# VM_SIZE=Standard_B1s. To list the allowed regions:
#     az policy assignment list --query "[].parameters.listOfAllowedLocations.value" -o tsv
# and set LOCATION to one of them.
set -euo pipefail

RESOURCE_GROUP=${RESOURCE_GROUP:-telespy-centralindia}
LOCATION=${LOCATION:-centralindia}
VM_NAME=${VM_NAME:-telespy-vm}
VM_SIZE=${VM_SIZE:-Standard_B2ats_v2}
DNS_LABEL=${DNS_LABEL:-telespy-ke}
ADMIN_USER=azureuser   # .github/workflows/deploy.yml connects as this user
SSH_KEY=${SSH_KEY:-$HOME/.ssh/telespy_azure}

here=$(cd "$(dirname "$0")" && pwd)

if [ ! -f "$SSH_KEY" ]; then
  echo "Creating SSH key $SSH_KEY (its private half goes into the SERVER_SSH_KEY GitHub secret)."
  ssh-keygen -t ed25519 -N "" -C telespy-deploy -f "$SSH_KEY"
fi

echo "Subscription: $(az account show --query name -o tsv)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

az vm create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --image Ubuntu2404 \
  --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --ssh-key-values "$SSH_KEY.pub" \
  --os-disk-size-gb 64 \
  --storage-sku Premium_LRS \
  --public-ip-sku Standard \
  --public-ip-address-dns-name "$DNS_LABEL" \
  --custom-data "$here/cloud-init.yml" \
  --output none

az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 80,443 --priority 900 --output none

fqdn=$(az network public-ip show --resource-group "$RESOURCE_GROUP" --name "${VM_NAME}PublicIP" --query dnsSettings.fqdn -o tsv)

cat <<DONE

Server created: $fqdn
Next (deploy/README.md has the details):
  1. GitHub secrets:  SERVER_HOST=$fqdn
                      SERVER_SSH_KEY=<contents of $SSH_KEY>
  2. ssh -i $SSH_KEY $ADMIN_USER@$fqdn
     then create /opt/telespy/.env from deploy/.env.example (SITE_DOMAIN=$fqdn).
  3. Run the Deploy workflow (Actions tab -> Deploy -> Run workflow).
DONE
