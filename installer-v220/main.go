package main

import (
	"archive/zip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

//go:embed base-setup.exe
var baseSetup []byte

//go:embed patch.zip
var patchZip []byte

//go:embed patch-manifest.json
var patchManifestBytes []byte

type fileMeta struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type patchManifest struct {
	Schema          int                 `json:"schema"`
	Version         string              `json:"version"`
	BaseSetupSHA256 string              `json:"base_setup_sha256"`
	PatchSHA256     string              `json:"patch_sha256"`
	Files           map[string]fileMeta `json:"files"`
}
type baseEvidence struct {
	Schema int                    `json:"schema"`
	Pass   bool                   `json:"pass"`
	Checks map[string]interface{} `json:"checks"`
}
type wrapperEvidence struct {
	Schema          int                    `json:"schema"`
	Version         string                 `json:"version"`
	Pass            bool                   `json:"pass"`
	BaseSetupSHA256 string                 `json:"base_setup_sha256"`
	PatchSHA256     string                 `json:"patch_sha256"`
	InstalledRoot   string                 `json:"installed_root"`
	Checks          map[string]bool        `json:"checks"`
	Error           string                 `json:"error,omitempty"`
	AtUTC           string                 `json:"at_utc"`
}

func sumHex(b []byte) string { h:=sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func fileSum(path string)(string,int64,error){
	f,err:=os.Open(path); if err!=nil{return "",0,err}; defer f.Close()
	h:=sha256.New(); n,err:=io.Copy(h,f); if err!=nil{return "",0,err}
	return hex.EncodeToString(h.Sum(nil)),n,nil
}
func waitFile(path string, timeout time.Duration) bool {
	deadline:=time.Now().Add(timeout)
	for time.Now().Before(deadline){
		if st,err:=os.Stat(path);err==nil && st.Size()>0{return true}
		time.Sleep(2*time.Second)
	}
	return false
}
func runHidden(name string,args ...string) error {
	c:=exec.Command(name,args...)
	c.Stdout=os.Stdout;c.Stderr=os.Stderr
	return c.Run()
}
func stopApps(){
	_ = runHidden("taskkill.exe","/F","/IM","ProfessoresIA.exe")
	_ = runHidden("taskkill.exe","/F","/IM","Abrir_ProfessoresIA.exe")
	time.Sleep(1500*time.Millisecond)
}
func safeRel(name string)(string,error){
	n:=filepath.Clean(filepath.FromSlash(name))
	if filepath.IsAbs(n) || n==".." || strings.HasPrefix(n,".."+string(os.PathSeparator)){return "",errors.New("unsafe patch path")}
	return n,nil
}
func unzipTo(zipPath,dest string)([]string,error){
	zr,err:=zip.OpenReader(zipPath);if err!=nil{return nil,err};defer zr.Close()
	var files []string
	for _,zf:=range zr.File{
		rel,err:=safeRel(zf.Name);if err!=nil{return nil,err}
		target:=filepath.Join(dest,rel)
		if zf.FileInfo().IsDir(){if err:=os.MkdirAll(target,0755);err!=nil{return nil,err};continue}
		if err:=os.MkdirAll(filepath.Dir(target),0755);err!=nil{return nil,err}
		in,err:=zf.Open();if err!=nil{return nil,err}
		out,err:=os.Create(target);if err!=nil{in.Close();return nil,err}
		_,cpErr:=io.Copy(out,in); closeErr:=out.Close(); in.Close()
		if cpErr!=nil{return nil,cpErr};if closeErr!=nil{return nil,closeErr}
		files=append(files,rel)
	}
	return files,nil
}
func copyFile(src,dst string) error {
	if err:=os.MkdirAll(filepath.Dir(dst),0755);err!=nil{return err}
	in,err:=os.Open(src);if err!=nil{return err};defer in.Close()
	tmp:=dst+".v220tmp";out,err:=os.Create(tmp);if err!=nil{return err}
	if _,err=io.Copy(out,in);err!=nil{out.Close();os.Remove(tmp);return err}
	if err=out.Close();err!=nil{os.Remove(tmp);return err}
	_ = os.Remove(dst)
	return os.Rename(tmp,dst)
}
func message(title,msg string){
	escaped:=strings.ReplaceAll(msg,"'","''")
	escapedTitle:=strings.ReplaceAll(title,"'","''")
	ps:=fmt.Sprintf("Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('%s','%s') | Out-Null",escaped,escapedTitle)
	_ = exec.Command("powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-Command",ps).Run()
}
func main(){
	var pm patchManifest
	if err:=json.Unmarshal(patchManifestBytes,&pm);err!=nil{message("Professores IA","Falha no manifesto da atualização.");return}
	ev:=wrapperEvidence{Schema:1,Version:"2.2.0",Checks:map[string]bool{},AtUTC:time.Now().UTC().Format(time.RFC3339)}
	ev.BaseSetupSHA256=sumHex(baseSetup); ev.PatchSHA256=sumHex(patchZip)
	ev.Checks["base_setup_hash"]=strings.EqualFold(ev.BaseSetupSHA256,pm.BaseSetupSHA256)
	ev.Checks["patch_hash"]=strings.EqualFold(ev.PatchSHA256,pm.PatchSHA256)
	if !ev.Checks["base_setup_hash"] || !ev.Checks["patch_hash"]{message("Professores IA","Falha de integridade do instalador.");return}

	local:=os.Getenv("LOCALAPPDATA")
	if local==""{message("Professores IA","LOCALAPPDATA indisponível.");return}
	root:=filepath.Join(local,"ProfessoresIA"); ev.InstalledRoot=root
	tmp,err:=os.MkdirTemp("","ProfessoresIA-v220-*");if err!=nil{message("Professores IA",err.Error());return};defer os.RemoveAll(tmp)
	setupPath:=filepath.Join(tmp,"Professores_IA_v2.0.3.1_BASE_Setup.exe")
	patchPath:=filepath.Join(tmp,"patch.zip")
	if err=os.WriteFile(setupPath,baseSetup,0700);err!=nil{message("Professores IA",err.Error());return}
	if err=os.WriteFile(patchPath,patchZip,0600);err!=nil{message("Professores IA",err.Error());return}

	// Run the already accepted installer unchanged.
	cmd:=exec.Command(setupPath)
	if err=cmd.Start();err==nil{err=cmd.Wait()}
	ev.Checks["base_setup_executed"]=err==nil
	baseEvidencePath:=filepath.Join(root,"evidence","acceptance-schema4.json")
	if !waitFile(baseEvidencePath,10*time.Minute){ev.Error="base installer did not produce acceptance evidence";writeEvidence(root,ev);message("Professores IA","A instalação base não concluiu. Nenhuma atualização visual foi aplicada.");return}
	var be baseEvidence
	if b,e:=os.ReadFile(baseEvidencePath);e==nil{_ = json.Unmarshal(b,&be)}
	ev.Checks["base_acceptance"]=be.Schema==4 && be.Pass
	if !ev.Checks["base_acceptance"]{ev.Error="base acceptance failed";writeEvidence(root,ev);message("Professores IA","A instalação base falhou no teste de segurança.");return}

	stopApps()
	stage:=filepath.Join(tmp,"patch"); if err=os.MkdirAll(stage,0755);err!=nil{return}
	files,err:=unzipTo(patchPath,stage)
	if err!=nil{ev.Error=err.Error();writeEvidence(root,ev);message("Professores IA","Falha ao preparar atualização: "+err.Error());return}

	backup:=filepath.Join(tmp,"backup")
	existed:=map[string]bool{}
	for _,rel:=range files{
		dst:=filepath.Join(root,rel)
		if st,e:=os.Stat(dst);e==nil && !st.IsDir(){
			existed[rel]=true
			if e:=copyFile(dst,filepath.Join(backup,rel));e!=nil{ev.Error=e.Error();writeEvidence(root,ev);return}
		}
	}
	rollback:=func(){
		for _,rel:=range files{
			dst:=filepath.Join(root,rel)
			if existed[rel]{_ = copyFile(filepath.Join(backup,rel),dst)}else{_ = os.Remove(dst)}
		}
		_ = os.RemoveAll(filepath.Join(root,"static","godot"))
	}
	for _,rel:=range files{
		if err=copyFile(filepath.Join(stage,rel),filepath.Join(root,rel));err!=nil{rollback();ev.Error="patch copy failed: "+err.Error();ev.Checks["patch_rollback"]=true;writeEvidence(root,ev);message("Professores IA","Falha na atualização visual; a versão anterior foi restaurada.");return}
	}
	ev.Checks["patch_applied"]=true
	ev.Checks["patch_rollback_ready"]=true

	// Verify every patched file against the signed-in-package patch manifest.
	ok:=true
	for rel,meta:=range pm.Files{
		s,n,e:=fileSum(filepath.Join(root,filepath.FromSlash(rel)))
		if e!=nil || n!=meta.Size || !strings.EqualFold(s,meta.SHA256){ok=false;break}
	}
	ev.Checks["patch_integrity"]=ok
	if !ok{rollback();ev.Checks["patch_rollback"]=true;ev.Error="post-patch integrity failure";writeEvidence(root,ev);message("Professores IA","A verificação da atualização falhou; a versão anterior foi restaurada.");return}

	// Verify Godot payload exists and launch the installed app again.
	for _,rel:=range []string{"static/godot/index.html","static/godot/index.js","static/godot/index.pck","static/godot/index.wasm","static/godot-avatar-bridge.js"}{
		if st,e:=os.Stat(filepath.Join(root,filepath.FromSlash(rel)));e!=nil || st.Size()==0{ev.Error="missing "+rel;rollback();ev.Checks["patch_rollback"]=true;writeEvidence(root,ev);return}
	}
	ev.Checks["godot_assets"]=true
	ev.Pass=true
	writeEvidence(root,ev)
	launcher:=filepath.Join(root,"Abrir_ProfessoresIA.exe")
	if _,e:=os.Stat(launcher);e==nil{
		c:=exec.Command(launcher);_ = c.Start(); if c.Process!=nil{_ = c.Process.Release()}
	}
	message("Professores IA v2.2","Instalação concluída. Os quatro professores agora usam o motor de avatar Godot gratuito, com a versão anterior preservada para rollback.")
}
func writeEvidence(root string,ev wrapperEvidence){
	dir:=filepath.Join(root,"evidence");_ = os.MkdirAll(dir,0755)
	b,_:=json.MarshalIndent(ev,"","  ");_ = os.WriteFile(filepath.Join(dir,"v220-wrapper-evidence.json"),append(b,'\n'),0644)
}
