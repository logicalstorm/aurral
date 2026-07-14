document.addEventListener("DOMContentLoaded", async () => {
  const nav = document.querySelector("nav");
  const navToggle = nav?.querySelector(".nav-toggle");
  const navLinks = nav?.querySelector(".nav-links");
  const mobileNavQuery = window.matchMedia("(max-width: 820px)");

  const setNavOpen = (open, { restoreFocus = false } = {}) => {
    if (!navToggle || !navLinks) return;

    const isOpen = mobileNavQuery.matches && open;
    navLinks.classList.toggle("is-open", isOpen);
    navLinks.toggleAttribute("inert", mobileNavQuery.matches && !isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");

    if (restoreFocus) navToggle.focus();
  };

  if (nav && navToggle && navLinks) {
    document.documentElement.classList.add("has-nav-menu");

    navToggle.addEventListener("click", () => {
      setNavOpen(navToggle.getAttribute("aria-expanded") !== "true");
    });

    navLinks.addEventListener("click", (event) => {
      if (event.target.closest("a")) setNavOpen(false);
    });

    document.addEventListener("click", (event) => {
      if (!nav.contains(event.target)) setNavOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && navToggle.getAttribute("aria-expanded") === "true") {
        setNavOpen(false, { restoreFocus: true });
      }
    });

    mobileNavQuery.addEventListener("change", () => setNavOpen(false));
    setNavOpen(false);
  }

  const syncScrolledState = () => {
    document.body.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.getAttribute("data-copy-target");
      const target = targetId ? document.getElementById(targetId) : null;
      const text = target?.textContent;
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const originalLabel = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = originalLabel;
        }, 1500);
      } catch (error) {
        console.error("Failed to copy snippet:", error);
      }
    });
  });

  document.querySelectorAll("[data-tabs]").forEach((tabsRoot) => {
    const tabs = Array.from(tabsRoot.querySelectorAll("[data-tab-target]"));
    const panels = Array.from(tabsRoot.querySelectorAll(".json-panel"));

    const activateTab = (nextTab) => {
      const targetId = nextTab.getAttribute("data-tab-target");
      tabs.forEach((tab) => {
        const isActive = tab === nextTab;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
      });

      panels.forEach((panel) => {
        const isActive = panel.id === targetId;
        panel.classList.toggle("is-active", isActive);
        panel.hidden = !isActive;
      });
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab));
    });
  });

  window.addEventListener("scroll", syncScrolledState, { passive: true });
  syncScrolledState();

  try {
    const res = await fetch("https://api.github.com/repos/lklynet/aurral");
    if (!res.ok) return;

    const data = await res.json();
    if (data.stargazers_count !== undefined) {
      const formattedStars = new Intl.NumberFormat("en-US").format(data.stargazers_count);

      document.querySelectorAll(".github-stars-count").forEach((el) => {
        el.textContent = formattedStars;
      });

      document.querySelectorAll(".github-stars-badge").forEach((el) => {
        el.style.display = "inline-flex";
      });
    }
  } catch (error) {
    console.error("Failed to fetch GitHub stars:", error);
  }
});
