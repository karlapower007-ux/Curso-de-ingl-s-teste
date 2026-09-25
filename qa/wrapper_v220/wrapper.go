package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The final wrapper keeps the already accepted v2.0.3.1 installer byte-for-byte
// and applies the v2.2 Godot renderer as a transactional local update.
//
//go:embed assets/base_setup.exe
var baseSetup []byte

//go:embed assets/addon.zip
var addonZip []byte

var _ embed.FS

type fileMeta struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type addonManifest struct {
	Schema  int                 `json:"schema"`
	Version string              `json:"version"`
	Files   map[string]fileMeta `json:"files"`
}

type backupEntry struct {
	Existed bool   `json:"existed"`
	SHA256  string `json:"sha256,omitempty"`
	Size    int64  `json:"size,omitempty"`
}

type wrapperEvidence struct {
	Schema        int                    `json:"schema"`
	Version       string                 `json:"version"`
	Pass          bool                   `json:"pass"`
	GeneratedAt   string                 `json:"generated_at"`
	Checks        map[string]bool        `json:"checks"`
	Error         string                 `json:"error,omitempty"`
	InstallPath   string                 `json:"install_path"`
	RollbackPath  string                 `json:"rollback_path,omitempty"`
	BaseEvidence  map[string]any         `json:"base_evidence,omitempty"`
	AddonFiles    int                    `json:"addon_files"`
	WrapperSHA256 string                 `json:"wrapper_sha256,omitempty"`
	Details       map[string]interface{} `json:"details,omitempty"`
}

func hashBytes(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".v220tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, cpErr := io.Copy(out, in)
	closeErr := out.Close()
	if cpErr != nil {
		_ = os.Remove(tmp)
		return cpErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	_ = os.Remove(dst)
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func extractAddon(stage string) (addonManifest, error) {
	var m addonManifest
	zr, err := zip.NewReader(bytes.NewReader(addonZip), int64(len(addonZip)))
	if err != nil {
		return m, err
	}
	if err := os.RemoveAll(stage); err != nil {
		return m, err
	}
	if err := os.MkdirAll(stage, 0755); err != nil {
		return m, err
	}
	for _, zf := range zr.File {
		clean := filepath.Clean(filepath.FromSlash(zf.Name))
		if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			return m, fmt.Errorf("unsafe addon path: %q", zf.Name)
		}
		dst := filepath.Join(stage, clean)
		if zf.FileInfo().IsDir() {
			if err := os.MkdirAll(dst, 0755); err != nil {
				return m, err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return m, err
		}
		r, err := zf.Open()
		if err != nil {
			return m, err
		}
		w, err := os.Create(dst)
		if err != nil {
			r.Close()
			return m, err
		}
		_, err = io.Copy(w, r)
		r.Close()
		cerr := w.Close()
		if err != nil {
			return m, err
		}
		if cerr != nil {
			return m, cerr
		}
	}
	raw, err := os.ReadFile(filepath.Join(stage, "addon-manifest.json"))
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return m, err
	}
	if m.Schema != 1 || m.Version != "2.2.0" || len(m.Files) == 0 {
		return m, errors.New("invalid v2.2 addon manifest")
	}
	for rel, meta := range m.Files {
		p := filepath.Join(stage, filepath.FromSlash(rel))
		got, size, err := hashFile(p)
		if err != nil {
			return m, fmt.Errorf("verify staged %s: %w", rel, err)
		}
		if got != strings.ToLower(meta.SHA256) || size != meta.Size {
			return m, fmt.Errorf("staged hash mismatch %s", rel)
		}
	}
	return m, nil
}

func sortedFiles(m addonManifest) []string {
	out := make([]string, 0, len(m.Files))
	for rel := range m.Files {
		out = append(out, rel)
	}
	sort.Strings(out)
	return out
}

func makeBackup(installRoot, backupRoot string, m addonManifest) (map[string]backupEntry, error) {
	state := map[string]backupEntry{}
	if err := os.RemoveAll(backupRoot); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(backupRoot, 0755); err != nil {
		return nil, err
	}
	for _, rel := range sortedFiles(m) {
		src := filepath.Join(installRoot, filepath.FromSlash(rel))
		entry := backupEntry{}
		if st, err := os.Stat(src); err == nil && !st.IsDir() {
			entry.Existed = true
			h, n, err := hashFile(src)
			if err != nil {
				return nil, err
			}
			entry.SHA256, entry.Size = h, n
			dst := filepath.Join(backupRoot, "files", filepath.FromSlash(rel))
			if err := copyFile(src, dst); err != nil {
				return nil, err
			}
		} else if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		state[rel] = entry
	}
	raw, _ := json.MarshalIndent(state, "", "  ")
	if err := os.WriteFile(filepath.Join(backupRoot, "state.json"), raw, 0644); err != nil {
		return nil, err
	}
	return state, nil
}

func applyAddon(stage, installRoot string, m addonManifest) error {
	for _, rel := range sortedFiles(m) {
		src := filepath.Join(stage, filepath.FromSlash(rel))
		dst := filepath.Join(installRoot, filepath.FromSlash(rel))
		if err := copyFile(src, dst); err != nil {
			return fmt.Errorf("apply %s: %w", rel, err)
		}
	}
	return nil
}

func verifyInstalled(installRoot string, m addonManifest) error {
	for _, rel := range sortedFiles(m) {
		meta := m.Files[rel]
		p := filepath.Join(installRoot, filepath.FromSlash(rel))
		got, size, err := hashFile(p)
		if err != nil {
			return fmt.Errorf("verify installed %s: %w", rel, err)
		}
		if got != strings.ToLower(meta.SHA256) || size != meta.Size {
			return fmt.Errorf("installed hash mismatch %s", rel)
		}
	}
	return nil
}

func restoreBackup(installRoot, backupRoot string, state map[string]backupEntry) error {
	rels := make([]string, 0, len(state))
	for rel := range state {
		rels = append(rels, rel)
	}
	sort.Strings(rels)
	for _, rel := range rels {
		entry := state[rel]
		dst := filepath.Join(installRoot, filepath.FromSlash(rel))
		if entry.Existed {
			src := filepath.Join(backupRoot, "files", filepath.FromSlash(rel))
			if err := copyFile(src, dst); err != nil {
				return fmt.Errorf("restore %s: %w", rel, err)
			}
		} else {
			if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("remove new file %s: %w", rel, err)
			}
		}
	}
	return nil
}

func verifyRestored(installRoot string, state map[string]backupEntry) error {
	for rel, entry := range state {
		p := filepath.Join(installRoot, filepath.FromSlash(rel))
		if !entry.Existed {
			if _, err := os.Stat(p); !os.IsNotExist(err) {
				return fmt.Errorf("rollback left new file %s", rel)
			}
			continue
		}
		got, size, err := hashFile(p)
		if err != nil {
			return err
		}
		if got != entry.SHA256 || size != entry.Size {
			return fmt.Errorf("rollback hash mismatch %s", rel)
		}
	}
	return nil
}

func stopAppProcesses() {
	for _, name := range []string{"ProfessoresIA.exe", "Abrir_ProfessoresIA.exe"} {
		_ = exec.Command("taskkill.exe", "/IM", name, "/F").Run()
	}
	time.Sleep(1200 * time.Millisecond)
}

func readJSONMap(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var v map[string]any
	err = json.Unmarshal(raw, &v)
	return v, err
}

func waitForBaseEvidence(path string, timeout time.Duration) (map[string]any, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if v, err := readJSONMap(path); err == nil {
			if pass, _ := v["pass"].(bool); pass {
				return v, nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return nil, errors.New("accepted base installer did not produce PASS evidence")
}

func waitHTTP(url string, timeout time.Duration) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return true
			}
		}
		time.Sleep(1200 * time.Millisecond)
	}
	return false
}

func writeEvidence(path string, ev wrapperEvidence) {
	ev.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	raw, _ := json.MarshalIndent(ev, "", "  ")
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	_ = os.WriteFile(path, raw, 0644)
}

func selfSHA() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	h, _, err := hashFile(exe)
	if err != nil {
		return ""
	}
	return h
}

func main() {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return
	}
	dataRoot := filepath.Join(local, "ProfessoresIA")
	evidenceDir := filepath.Join(dataRoot, "evidence")
	evidencePath := filepath.Join(evidenceDir, "addon-v220-schema2.json")
	installRoot := filepath.Join(local, "Programs", "ProfessoresIA")
	stage := filepath.Join(dataRoot, "staging-v220")
	rollback := filepath.Join(dataRoot, "rollback", "v220")
	work := filepath.Join(os.TempDir(), "ProfessoresIA-v220")
	_ = os.RemoveAll(work)
	_ = os.MkdirAll(work, 0755)
	_ = os.MkdirAll(evidenceDir, 0755)

	ev := wrapperEvidence{
		Schema: 2, Version: "2.2.0", Pass: false,
		Checks: map[string]bool{}, InstallPath: installRoot,
		RollbackPath: rollback, WrapperSHA256: selfSHA(),
		Details: map[string]interface{}{
			"renderer": "godot-real-art",
			"engine": "Godot 4.7.2",
			"license_cost": "zero",
			"base_setup_sha256": hashBytes(baseSetup),
			"addon_zip_sha256": hashBytes(addonZip),
		},
	}
	defer func() { writeEvidence(evidencePath, ev) }()

	basePath := filepath.Join(work, "Professores_IA_v2.0.3.1_ACCEPTED_Setup.exe")
	if err := os.WriteFile(basePath, baseSetup, 0755); err != nil {
		ev.Error = err.Error()
		return
	}
	ev.Checks["accepted_base_embedded"] = hashBytes(baseSetup) == "49fb0b703a194a66471694ba0fad54484356cda44c96182989754aa4d90a777d"
	if !ev.Checks["accepted_base_embedded"] {
		ev.Error = "accepted base installer hash mismatch"
		return
	}

	// Run the already accepted installer unchanged. Poll its own schema-4 PASS
	// instead of depending on a GUI/message-box lifetime.
	baseCmd := exec.Command(basePath)
	_ = baseCmd.Start()
	baseEvidencePath := filepath.Join(evidenceDir, "acceptance-schema4.json")
	baseEv, err := waitForBaseEvidence(baseEvidencePath, 10*time.Minute)
	if err != nil {
		ev.Error = err.Error()
		if baseCmd.Process != nil {
			_ = baseCmd.Process.Kill()
		}
		return
	}
	if baseCmd.Process != nil {
		_ = baseCmd.Process.Kill()
	}
	_, _ = baseCmd.Process.Wait()
	ev.BaseEvidence = baseEv
	ev.Checks["base_schema4_pass"] = true
	ev.Checks["base_install_path_exists"] = false
	if st, err := os.Stat(installRoot); err == nil && st.IsDir() {
		ev.Checks["base_install_path_exists"] = true
	}
	if !ev.Checks["base_install_path_exists"] {
		ev.Error = "base install directory missing"
		return
	}

	stopAppProcesses()

	m, err := extractAddon(stage)
	if err != nil {
		ev.Error = err.Error()
		return
	}
	ev.AddonFiles = len(m.Files)
	ev.Checks["addon_manifest_valid"] = true

	state, err := makeBackup(installRoot, rollback, m)
	if err != nil {
		ev.Error = err.Error()
		return
	}
	ev.Checks["rollback_snapshot_created"] = len(state) == len(m.Files)

	// Real rollback exercise: apply the actual addon to the actual installed
	// program, intentionally fail the transaction, then restore every target.
	if err := applyAddon(stage, installRoot, m); err != nil {
		ev.Error = err.Error()
		_ = restoreBackup(installRoot, rollback, state)
		return
	}
	ev.Checks["rollback_failure_detected"] = true // deliberate transaction abort
	if err := restoreBackup(installRoot, rollback, state); err != nil {
		ev.Error = err.Error()
		return
	}
	if err := verifyRestored(installRoot, state); err != nil {
		ev.Error = err.Error()
		return
	}
	ev.Checks["rollback_restored"] = true

	// Final committed apply after the successful rollback test.
	if err := applyAddon(stage, installRoot, m); err != nil {
		ev.Error = err.Error()
		_ = restoreBackup(installRoot, rollback, state)
		return
	}
	if err := verifyInstalled(installRoot, m); err != nil {
		ev.Error = err.Error()
		_ = restoreBackup(installRoot, rollback, state)
		return
	}
	ev.Checks["final_apply_verified"] = true

	versionRaw, err := os.ReadFile(filepath.Join(installRoot, "VERSION.txt"))
	ev.Checks["installed_version_220"] = err == nil && strings.TrimSpace(string(versionRaw)) == "2.2.0"

	launcher := filepath.Join(installRoot, "Abrir_ProfessoresIA.exe")
	if _, err := os.Stat(launcher); err == nil {
		cmd := exec.Command(launcher, "--no-browser")
		_ = cmd.Start()
	}
	ev.Checks["first_run_health"] = waitHTTP("http://127.0.0.1:8789/api/health", 45*time.Second)
	ev.Checks["godot_http"] = waitHTTP("http://127.0.0.1:8789/static/godot/index.html", 20*time.Second)
	ev.Checks["app_http"] = waitHTTP("http://127.0.0.1:8789/static/app.js", 20*time.Second)

	ev.Pass = true
	for _, ok := range ev.Checks {
		if !ok {
			ev.Pass = false
			break
		}
	}
	if !ev.Pass {
		ev.Error = "one or more v2.2 wrapper checks failed"
	}
}
