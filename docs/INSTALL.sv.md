# ChurchVault: installations- och inställningsguide

*[English version](INSTALL.md)*

När programmet är igång finns [användarhandboken](USER-MANUAL.sv.md) för det dagliga arbetet.

**Om språket:** ChurchVault och GitHub visas på engelska. Namn på knappar, menyer och skärmar står därför kvar på engelska i **fetstil**, så att du känner igen dem på skärmen. Förklaringarna är på svenska.

ChurchVault samlar församlingens lösenord, kortuppgifter, dörrkoder och dokument i ett gemensamt, krypterat valv. Allt krypteras på din egen dator innan det laddas upp. Kopian på GitHub går inte att läsa utan en medlems lösenord.

Det finns 3 till 4 medlemmar, och **alla medlemmar är administratörer**: vem som helst kan godkänna eller ta bort andra.

---

## 1. Installera programmet

Hämta den senaste versionen från sidan **Releases**:
<https://github.com/bobergsten/ChurchVault/releases/latest>

| Din dator | Fil att hämta |
|---|---|
| Mac med Apple-chip (M1, M2, M3, M4 ...) | `ChurchVault-<version>-mac-arm64.dmg` |
| Mac med Intel-chip | `ChurchVault-<version>-mac-x64.dmg` |
| Windows 10 eller 11 | `ChurchVault-<version>-win-x64.exe` |

Osäker på vilken Mac du har? Äppelmenyn → *Om den här Macen* (*About This Mac*). "Chip: Apple M…" betyder Apple-chip, "Processor: Intel" betyder Intel.

Programmet är ännu inte signerat med ett betalt certifikat från Apple eller Microsoft, så din dator varnar första gången. Det är väntat.

### Mac

1. Öppna `.dmg`-filen och dra **ChurchVault** till **Applications** (Program).
2. Öppna ChurchVault från Program. macOS säger att det inte kan verifiera programmet. Klicka på **Done** (inte "Move to Trash").
3. Öppna **System Settings → Privacy & Security** (på svenska ungefär Systeminställningar → Integritet och säkerhet). Scrolla ned till meddelandet om ChurchVault, klicka på **Open Anyway** (Öppna ändå) och bekräfta med ditt Mac-lösenord.
4. Därefter öppnas ChurchVault som vanligt.

Om macOS i stället säger att programmet "is damaged and can't be opened" (är skadat och kan inte öppnas) öppnar du programmet **Terminal** och kör det här en gång, och öppnar sedan programmet igen:

```
xattr -dr com.apple.quarantine /Applications/ChurchVault.app
```

### Windows

1. Kör den nedladdade `.exe`-filen.
2. Windows SmartScreen kan visa "Windows protected your PC" (Windows skyddade din dator). Klicka på **More info** (Mer information) och sedan **Run anyway** (Kör ändå).
3. Följ installationsprogrammet. Det installerar bara för din användare och kräver inga administratörsrättigheter.

---

## 2. Första installationen (en person, en gång)

Bara den **första** personen gör detta. Alla andra följer avsnitt 3.

### 2a. Skapa en GitHub-organisation och ett privat valvsförråd

Du behöver ett gratis GitHub-konto (<https://github.com/signup>). Slå på tvåfaktorsautentisering (Settings → Password and authentication). Den skyddar församlingens data.

**Varför en organisation:** varje medlem loggar in på GitHub med sin **egen** token, aldrig en delad. En fine-grained token, den säkra sorten som kan begränsas till bara valvet, fungerar bara för förråd som ägs av tokeninnehavarens eget konto eller av en organisation personen tillhör. Genom att lägga valvet i en gratis organisation kan alla medlemmar använda en sådan token. Då tillhör valvet dessutom ingen enskild person.

1. På github.com klickar du på **+** → **New organization** → **Free**. Ge den ett namn, till exempel `din-forsamling-valv`.
2. Under **People**: se till att minst **två** medlemmar blir organisationens **owners** (ägare). Bjud in dem nu eller senare, se avsnitt 3. Då är församlingen aldrig beroende av en enda persons konto.
3. I organisationen klickar du på **+** → **New repository**. Owner: organisationen. Ge det ett namn, till exempel `vault`.
4. Välj **Private**. Det här är viktigt.
5. Lägg **inte** till någon README, .gitignore eller licens. Låt det vara tomt.
6. Klicka på **Create repository** och kopiera adressen, till exempel `https://github.com/din-forsamling-valv/vault`.

Det här förrådet är skilt från själva ChurchVault-programmet. Det innehåller bara krypterade filer.

**Ligger valvet redan på ditt personliga konto?** Flytta det: förrådet → **Settings** → **Danger Zone** → **Transfer ownership** → organisationen. Därefter, på varje dator som använder ChurchVault: den övre raden → **Disconnect**, och sedan **Set up GitHub sync** med den nya adressen och den medlemmens token.

### 2b. Skapa en åtkomsttoken

Programmet använder en token, som fungerar som ett begränsat lösenord, för att ladda upp och ladda ner de krypterade filerna. **Varje medlem skapar sin egen** och delar den aldrig. När någon slutar räcker det att ta bort personen på GitHub, så slutar personens token att fungera utan att det påverkar någon annan.

1. github.com → din bild → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Ge den namnet `ChurchVault på <den här datorn>`. Sätt **Expiration** till den längsta tillåtna tiden och lägg en påminnelse i din kalender för det datumet. När den går ut visar programmet ett synkroniseringsfel med en knapp **Update token** (avsnitt 5).
3. **Resource owner**: välj **organisationen**, inte ditt eget konto. Om organisationen inte finns i listan ska du först acceptera inbjudan att gå med i den.
4. **Repository access**: *Only select repositories* → välj valvets förråd.
5. **Permissions** → *Repository permissions* → **Contents: Read and write**. Inget annat behövs.
6. Klicka på **Generate token** och kopiera den. GitHub visar den bara en gång.

Om GitHub säger att token är **pending approval** (väntar på godkännande) godkänner en organisationsägare den: organisationen → **Settings** → **Personal access tokens** → **Pending requests**. Ägare kan också stänga av kravet på godkännande på den sidan.

**Om valvet måste ligga kvar på ett personligt konto** (rekommenderas inte): då kan andra medlemmar inte skapa fine-grained tokens för det. De behöver i stället en *classic*-token: **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**, behörighet (scope) **`repo`**. En classic-token kommer åt *alla* privata förråd som ägaren har tillgång till, inte bara valvet. Använd den därför bara om deras GitHub-konton inte innehåller något annat privat.

### 2c. Skapa valvet

1. Öppna ChurchVault → **Create a new vault**.
2. Skriv ditt namn och ett starkt lösenord (minst 10 tecken). En kort mening fungerar bra, till exempel `blå orgel spelar på söndag`.
3. Programmet visar en **recovery key** (återställningsnyckel). **Skriv ut den** och förvara den på ett säkert, låst ställe, till exempel i kyrkkansliets kassaskåp. Den visas bara en gång. Den kan öppna valvet om alla har glömt sina lösenord, så behandla den som nyckeln till kassaskåpet.
4. Lås upp med ditt lösenord.
5. Klicka på **Set up GitHub sync**, klistra in förrådets adress och token och klicka på **Connect**.

Valvet är klart. Lägg till de första posterna med **+ New**.

---

## 3. Lägga till en ny medlem

**Den nya personen:**

1. Skapar ett GitHub-konto (med tvåfaktorsautentisering) och berättar sitt GitHub-användarnamn för dig.
2. Installerar programmet (avsnitt 1).

**En organisationsägare:**

3. På github.com öppnar du organisationen → **People** → **Invite member** → personens användarnamn (roll *Member*, eller *Owner* om personen ska kunna bjuda in andra). Öppna sedan valvets förråd → **Settings** → **Collaborators and teams** → **Add people** → personens användarnamn med rollen **Write**. Be personen acceptera inbjudan (hen får ett e-postmeddelande).

**Den nya personen:**

4. Skapar sin **egen** token, som i 2b (resource owner: organisationen, bara valvets förråd, Contents: Read and write).
5. Öppnar ChurchVault → **Join an existing vault**, skriver sitt namn, ett eget lösenord, förrådets adress och sin token, och klickar på **Request access**.
6. Programmet visar en **säkerhetskod** (till exempel `1FB7 E358 FD15 B1F3 49FE`).

**Ni båda:**

7. Den befintliga medlemmen öppnar **Members** i ChurchVault (efter en stund, eller efter **Sync now**). Den nya personen visas som *waiting for approval* (väntar på godkännande), med en säkerhetskod.
8. **Jämför koderna per telefon eller på plats**, inte i e-post eller sms. De måste stämma exakt. Om de skiljer sig kan någon försöka ta sig in: godkänn inte.
9. Klicka på **Approve**.
10. Den nya personen klickar på **Check if I have been approved** och låser upp med sitt eget lösenord.

---

## 4. Daglig användning

- **Sök** efter poster med sökrutan. Den söker i rubriker, taggar, anteckningar, webbplatser, användarnamn och filnamn, men aldrig i lösenord eller koder.
- **Kopiera** ett lösenord med *Copy*. Det töms från urklipp efter 30 sekunder och när valvet låses.
- **Lås** med knappen Lock. Valvet låses också av sig självt efter 5 minuter utan användning, när skärmen låses och när datorn går i viloläge.
- **Synkronisering** sker automatiskt (några sekunder efter en ändring och var femte minut). Den övre raden visar när det senast skedde. Utan internet kan du fortsätta arbeta, och ändringarna laddas upp senare.
- **Filer** (fastighetsbrev, försäkringsbrev, skanningar): skapa en post av typen *Document* och använd *Add files…* (upp till 25 MB per fil).
- **⚠ Conflict** på en post betyder att två personer ändrade den samtidigt. Båda versionerna behölls. Öppna den som är märkt *Conflict*, jämför den med den andra posten med samma namn och välj sedan *Use this version* eller *Discard this version*.

Mer om allt detta finns i [användarhandboken](USER-MANUAL.sv.md).

---

## 5. När något ändras

### Någon slutar

1. Öppna **Members** → **Remove** bredvid personens namn och bekräfta.
2. Programmet byter valvets nyckel och visar en **ny återställningsnyckel**. Skriv ut den och byt ut (strimla) den gamla utskriften, eftersom den gamla nyckeln inte längre fungerar.
3. På github.com tar du bort personen ur organisationen (organisationen → **People** → personens namn → **Remove from organization**). Det stoppar också personens token.
4. Byt de viktiga lösenorden, korten och dörrkoderna som personen kände till. Programmet kan inte få någon att glömma det den har sett.

Gör det när de andra inte är mitt uppe i att redigera.

### Glömt lösenord

Klicka på **Forgot password?** på låsskärmen, skriv den utskrivna återställningsnyckeln och välj ett nytt lösenord. Om återställningsnyckeln inte går att hitta kan en annan medlem ta bort dig och bjuda in dig igen (avsnitt 3).

### Byta ditt lösenord

**Members** → *Change my password*.

### GitHub-token har gått ut

Den övre raden visar ett synkroniseringsfel och en knapp **Update token**. Förnya din token (Settings → Developer settings → Fine-grained tokens → token → **Regenerate**), eller skapa en ny som i 2b, och klistra in den.

### Ny dator för en befintlig medlem

Installera programmet, välj **Join an existing vault** med ditt namn och låt en annan medlem godkänna dig. Du visas då två gånger i **Members** (en gång per dator). Om du inte längre använder den gamla datorn tar du bort den posten. Det byter också valvets nyckel, så skriv ut den nya återställningsnyckeln.

---

## 6. Uppdateringar

- **Windows:** nya versioner laddas ned i bakgrunden. En rad högst upp visar *Restart and update* när en är klar.
- **Mac:** en rad högst upp berättar att en ny version finns. Klicka på *Download* och installera den som i avsnitt 1. Ditt valv påverkas inte.

---

## 7. Goda vanor

- Varje medlem använder ett starkt, unikt lösenord till ChurchVault och tvåfaktorsautentisering på GitHub.
- Förvara den utskrivna återställningsnyckeln inlåst, och vet var den finns.
- Lås programmet (eller datorn) när du går ifrån den.
- Installera inte ChurchVault på delade eller offentliga datorer.
- Valvets förråd måste förbli **privat**. GitHub kan ändå inte läsa innehållet, men det finns ingen anledning att visa ens de krypterade filerna.
