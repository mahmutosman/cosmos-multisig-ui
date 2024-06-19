import { useChains } from "@/context/ChainsContext";
import { getConnectError } from "@/lib/errorHelpers";
import { MultisigFromQuery } from "@/lib/graphqlHelpers";
import { requestJson } from "@/lib/request";
import { toastError } from "@/lib/utils";
import { DbNonce } from "@/types/db";
import { WalletInfo } from "@/types/signing";
import { MultisigThresholdPubkey } from "@cosmjs/amino";
import { toBase64 } from "@cosmjs/encoding";
import { StargateClient } from "@cosmjs/stargate";
import { Loader2, MoveRightIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useLayoutEffect, useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

type FetchedMultisigs = {
  readonly created: readonly MultisigFromQuery[];
  readonly belonged: readonly MultisigFromQuery[];
};

export default function ListUserMultisigs() {
  const { chain } = useChains();
  const [loading, setLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<Omit<WalletInfo, "type"> | null>(null);
  const [showBelonged, setShowBelonged] = useState(false);
  const [multisigs, setMultisigs] = useState<FetchedMultisigs | null>(null);

  const getSignature = useCallback(
    async (address: string) => {
      const client = await StargateClient.connect(chain.nodeAddress);
      const accountOnChain = await client.getAccount(address);

      if (!accountOnChain) {
        throw new Error(`Account not found on chain for ${address}`);
      }

      const { nonce }: DbNonce = await requestJson(
        `/api/chain/${chain.chainId}/nonce/${accountOnChain.address}`,
      );

      const { signature } = await window.keplr.signAmino(chain.chainId, accountOnChain.address, {
        chain_id: "",
        account_number: "0",
        sequence: "0",
        fee: { gas: "0", amount: [] },
        msgs: [
          {
            type: "sign/MsgSignData",
            value: {
              signer: accountOnChain.address,
              data: toBase64(
                new Uint8Array(
                  Buffer.from(
                    JSON.stringify({
                      title: `Keplr Login to ${chain.chainDisplayName}`,
                      description: "Sign this no fee transaction to login with your Keplr wallet",
                      nonce,
                    }),
                  ),
                ),
              ),
            },
          },
        ],
        memo: "",
      });

      return signature;
    },
    [chain.chainDisplayName, chain.chainId, chain.nodeAddress],
  );

  const fetchMultisigs = useCallback(
    async (address: string) => {
      try {
        const signature = await getSignature(address);

        const newMultisigs: FetchedMultisigs = await requestJson(
          `/api/chain/${chain.chainId}/multisig/list`,
          {
            body: { signature, chain },
          },
        );

        setMultisigs(newMultisigs);
      } catch (e: unknown) {
        console.error("Failed to fetch multisigs:", e);
        toastError({
          description: "Failed to fetch multisigs",
          fullError: e instanceof Error ? e : undefined,
        });
      }
    },
    [chain, getSignature],
  );

  const connectWallet = useCallback(async () => {
    try {
      setLoading(true);

      await window.keplr.enable(chain.chainId);
      window.keplr.defaultOptions = {
        sign: { preferNoSetFee: true, preferNoSetMemo: true, disableBalanceCheck: true },
      };

      const { bech32Address: address, pubKey: pubKeyArray } = await window.keplr.getKey(
        chain.chainId,
      );

      const pubKey = toBase64(pubKeyArray);

      setWalletInfo({ address, pubKey });

      await fetchMultisigs(address);
    } catch (e) {
      const connectError = getConnectError(e);
      console.error(connectError, e);
      toastError({
        description: connectError,
        fullError: e instanceof Error ? e : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [chain.chainId, fetchMultisigs]);

  useLayoutEffect(() => {
    if (!walletInfo?.address) {
      return;
    }

    const accountChangeKey = "keplr_keystorechange";
    window.addEventListener(accountChangeKey, connectWallet);

    return () => {
      window.removeEventListener(accountChangeKey, connectWallet);
    };
  }, [connectWallet, walletInfo?.address]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Multisigs</CardTitle>
        <CardDescription>
          Your list of created multisigs on {chain.chainDisplayName}. Verify your identity with
          Keplr by signing a message for free.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!walletInfo && !multisigs ? (
          <Button onClick={connectWallet} disabled={loading} variant="outline">
            {loading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Image
                alt=""
                src={`/assets/icons/keplr.svg`}
                width={20}
                height={20}
                className="mr-2"
              />
            )}
            Verify identity
          </Button>
        ) : null}
        {walletInfo && !multisigs ? (
          <div className="flex items-center gap-2">
            <Loader2 className="animate-spin" />
            <p>Loading multisigs</p>
          </div>
        ) : null}
        {!showBelonged && multisigs && !multisigs.created.length
          ? "You have not created any multisig"
          : null}
        {showBelonged && multisigs && !multisigs.belonged.length
          ? "You are not a member of any multisig"
          : null}
        {multisigs?.created.length || multisigs?.belonged.length ? (
          <>
            {multisigs.created.length !== multisigs.belonged.length ? (
              <div className="flex items-center space-x-2">
                <Switch
                  id="multisigs-type"
                  checked={showBelonged}
                  onCheckedChange={(checked) => {
                    setShowBelonged(checked);
                  }}
                />
                <Label htmlFor="multisigs-type">Show all multisigs I'm a member of</Label>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              {(showBelonged ? multisigs.belonged : multisigs.created).map((multisig) => {
                const pubkey: MultisigThresholdPubkey = JSON.parse(multisig.pubkeyJSON);

                return (
                  <Link
                    key={multisig.address}
                    href={`/${chain.registryName}/${multisig.address}`}
                    className="flex items-center space-x-2 rounded-md border p-2 transition-colors hover:cursor-pointer hover:bg-muted/50"
                  >
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge className="text-sm text-muted-foreground">
                          {pubkey.value.threshold} / {pubkey.value.pubkeys.length}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div>
                          <p>threshold: {pubkey.value.threshold}</p>
                          <p>members: {pubkey.value.pubkeys.length}</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{multisig.address}</p>
                    </div>
                    <MoveRightIcon className="w-5" />
                  </Link>
                );
              })}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
