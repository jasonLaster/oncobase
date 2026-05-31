"use client";

import {
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CommandIcon, MessageCircleIcon } from "lucide-react";
import {
  WikiHeader,
  WikiHeaderButton,
  WikiHeaderSearchForm,
  WikiLogo,
} from "@oncobase/wiki-shell";
import { ActionsMenu } from "@/components/actions-menu";
import { openCommandPalette } from "@/components/command-palette";

function NewChatButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pathname.startsWith("/chat")) {
      window.dispatchEvent(new CustomEvent("chat:new"));
    }
    startTransition(() => {
      router.push("/chat");
    });
  }

  return (
    <WikiHeaderButton
      aria-label="New chat"
      data-test-id="header-new-chat"
      data-pending={pending ? "" : undefined}
      onClick={handleClick}
      title="New chat"
    >
      <MessageCircleIcon size={14} aria-hidden="true" />
      <span>New chat</span>
    </WikiHeaderButton>
  );
}

export function Header() {
  const isDev =
    typeof process !== "undefined" && process.env.NODE_ENV === "development";

  return (
    <WikiHeader
      data-test-id="app-header"
      home={
        <Link href="/" aria-label="Home" data-test-id="header-home">
          <WikiLogo dev={isDev} />
        </Link>
      }
      search={
        <div className="wiki-shell-header-primary-controls">
          <Suspense fallback={<HeaderSearchFallback />}>
            <HeaderSearch />
          </Suspense>
          <NewChatButton />
          <WikiHeaderButton
            aria-label="Find files (⌘P)"
            title="Find files (⌘P)"
            data-test-id="header-command-palette"
            onClick={openCommandPalette}
          >
            <CommandIcon size={14} aria-hidden="true" />
            <span>Find files</span>
          </WikiHeaderButton>
        </div>
      }
      actions={
        <ActionsMenu />
      }
    />
  );
}

function subscribeHydrationSnapshot() {
  return () => {};
}

function HeaderSearch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeHydrationSnapshot,
    () => true,
    () => false,
  );
  const derivedQuery = pathname === "/search" ? (searchParams.get("q") || "") : "";
  const [query, setQuery] = useState(derivedQuery);

  useEffect(() => {
    setQuery(derivedQuery);
  }, [derivedQuery]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const trimmed = String(formData.get("q") ?? "").trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <WikiHeaderSearchForm
      action="/search"
      method="get"
      onSubmit={onSubmit}
      data-test-id="header-search-form"
      data-hydrated={hydrated ? "true" : "false"}
      inputProps={
        {
          "data-test-id": "header-search-form-input",
          name: "q",
          value: query,
          onChange: (event) => setQuery(event.currentTarget.value),
          onKeyDown: (event) => event.stopPropagation(),
        } as React.InputHTMLAttributes<HTMLInputElement>
      }
    />
  );
}

function HeaderSearchFallback() {
  return (
    <WikiHeaderSearchForm
      action="/search"
      method="get"
      data-test-id="header-search-form"
      data-hydrated="false"
      inputProps={
        {
          "data-test-id": "header-search-fallback-input",
          name: "q",
          disabled: true,
        } as React.InputHTMLAttributes<HTMLInputElement>
      }
    />
  );
}
