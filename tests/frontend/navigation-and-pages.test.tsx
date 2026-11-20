import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import NotFound from "@/app/not-found";
import { viewer } from "./session-fixtures";
const navigation = vi.hoisted(() => ({ pathname: "/library" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
it("uses neutral unavailable-page copy with destinations for creators and learners", () => {
  render(<NotFound />);
  expect(
    screen.getByRole("heading", { name: "This page isn’t available." }),
  ).toBeVisible();
  for (const [name, href] of [
    ["Back to home", "/"],
    ["Scenario library", "/library"],
    ["Session history", "/history"],
    ["Creator workspace", "/creator"],
  ])
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
});
it("offers guests preview and authentication navigation", () => {
  render(<SiteHeader viewer={null} />);
  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute(
    "href",
    "/library",
  );
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/sign-in",
  );
  expect(
    screen.queryByRole("link", { name: "History" }),
  ).not.toBeInTheDocument();
});
it("learners retain library/history/account navigation", () => {
  render(<SiteHeader viewer={viewer} />);
  expect(screen.getByRole("link", { name: "Library" })).toBeVisible();
  expect(screen.getByRole("link", { name: "History" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Creator" }),
  ).not.toBeInTheDocument();
});
it("creators keep learner navigation alongside creator space", () => {
  render(
    <SiteHeader
      viewer={{ ...viewer, role: "creator", capabilities: ["learn", "create"] }}
    />,
  );
  for (const name of ["Home", "Library", "History", "Creator", "Account"])
    expect(screen.getByRole("link", { name })).toBeVisible();
});

it.each([
  "/library",
  "/library/players/one",
  "/library/scenario",
  "/play/session",
])("marks Library active at %s without retired tabs", (pathname) => {
  navigation.pathname = pathname;
  render(<SiteHeader viewer={viewer} />);
  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByRole("link", { name: "Play" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Demo" })).not.toBeInTheDocument();
});
