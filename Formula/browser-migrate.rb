# Homebrew formula template.
#
# browser-migrate is macOS-only. To publish:
#   1. Create a tap repo: `gh repo create navotvolkgroundup/homebrew-tap --public`
#   2. Push a `vX.Y.Z` tag here — the Release workflow builds the two binaries.
#   3. Fill in `version` and both `sha256` values (shasum -a 256 on each asset),
#      commit this file into the tap repo under Formula/.
#   4. Users then run: `brew install navotvolkgroundup/tap/browser-migrate`
class BrowserMigrate < Formula
  desc "Migrate your browser profile (bookmarks, history, tabs) between browsers"
  homepage "https://github.com/navotvolkgroundup/browser-migrate"
  version "0.1.0"
  license "MIT"

  on_arm do
    url "https://github.com/navotvolkgroundup/browser-migrate/releases/download/v#{version}/browser-migrate-macos-arm64"
    sha256 "REPLACE_WITH_ARM64_SHA256"
  end
  on_intel do
    url "https://github.com/navotvolkgroundup/browser-migrate/releases/download/v#{version}/browser-migrate-macos-x64"
    sha256 "REPLACE_WITH_X64_SHA256"
  end

  def install
    bin.install Dir["browser-migrate-*"].first => "browser-migrate"
  end

  test do
    assert_match "browser-migrate", shell_output("#{bin}/browser-migrate --help")
  end
end
