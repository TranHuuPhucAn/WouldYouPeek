import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import NotFound from "@/app/not-found";
import { viewer } from "./session-fixtures";
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
  expect(screen.getByRole("link", { name: "Demo" })).toHaveAttribute(
    "href",
    "/demo",
  );
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/sign-in",
  );
  expect(
    screen.queryByRole("link", { name: "History" }),
  ).not.toBeInTheDocument();
});
it("learners retain play/history/account navigation", () => {
  render(<SiteHeader viewer={viewer} />);
  expect(screen.getByRole("link", { name: "Play" })).toBeVisible();
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
  for (const name of ["Play", "History", "Account", "Creator"])
    expect(screen.getByRole("link", { name })).toBeVisible();
});
