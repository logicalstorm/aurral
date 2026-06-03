import { Heart, ExternalLink } from "lucide-react";

function DonatePage() {
  return (
    <div className="animate-fade-in max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center gap-3 mb-4">
          <Heart className="w-8 h-8 text-[#e85d75]" />
          <h1 className="text-3xl font-bold" style={{ color: "#fff" }}>
            Support Aurral
          </h1>
        </div>
        <p className="mb-6" style={{ color: "#c1c1c3" }}>
          Aurral is open source. Sponsorship helps cover hosting, development
          time, and new features for the community.
        </p>
        <a
          href="https://github.com/sponsors/lklynet/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-colors"
          style={{
            backgroundColor: "#211f27",
            color: "#fff",
          }}
        >
          Sponsor on GitHub
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

export default DonatePage;
