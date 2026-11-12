# ChurchVault – användarhandbok

*[English version](USER-MANUAL.md)*

För dig som använder ChurchVault 0.1 i vardagen. Installation och första inställning av GitHub beskrivs i [installationsguiden](INSTALL.sv.md).

**Om språket i programmet:** ChurchVault visas på engelska. Namn på knappar och skärmar står därför kvar på engelska i **fetstil** i den här handboken, så att du känner igen dem på skärmen. Förklaringarna är på svenska.

## Om ChurchVault

ChurchVault är ett gemensamt, krypterat anteckningsblock för församlingens hemligheter. Det används av tre till fyra betrodda personer som alla är administratörer. Programmet körs på Mac- och Windows-datorer.

Det kan lagra fem sorters poster:

- **Logins** (inloggningar): webbplats, användarnamn, lösenord och en valfri hemlighet för engångskoder.
- **Cards** (kort): kortinnehavare, nummer, giltighetstid, säkerhetskod (CVV) och PIN-kod.
- **Door codes** (dörrkoder): plats, kod, vilka som har den och när den senast ändrades.
- **Documents** (dokument): skannade filer som fastighetsbrev eller försäkringsbrev, högst 25 MB per fil.
- **Notes** (anteckningar): fri text.

Allt låses med kryptering på din egen dator innan det sparas eller laddas upp. Medlemmarnas kopior hålls i takt med varandra via ett privat GitHub-förråd, men GitHub innehåller bara oläsliga data. Ingen som saknar en medlems lösenord, inte ens GitHub, kan läsa posterna.

Den här handboken är för dig som använder programmet i vardagen. Första installationen och inställningen av GitHub finns i installationsguiden som följer med programmet.

## Viktiga begrepp

Sex ord återkommer hela tiden. När du kan dem blir resten av handboken enkel.

| Ord | Vad det betyder |
| --- | --- |
| Valv (vault) | Alla församlingens poster. Det finns ett enda valv som alla medlemmar delar. |
| Medlem (member) | En person med åtkomst. Varje medlem har sitt eget lösenord och kan godkänna eller ta bort andra medlemmar. |
| Lösenord (password) | Ditt personliga lösenord till ChurchVault, minst 10 tecken. Det sparas ingenstans och går inte att slå upp. |
| Återställningsnyckel (recovery key) | En lång utskriven kod som visas en enda gång när valvet skapas. Den öppnar valvet om alla har glömt sina lösenord. |
| Säkerhetskod (security code) | En kort kod som `1FB7 E358 FD15 B1F3 49FE` och som identifierar en person. Du jämför den per telefon eller på plats innan du godkänner en ny medlem. |
| GitHub-token | Ett begränsat lösenord som låter programmet ladda upp och ladda ner de krypterade filerna. Varje medlem har sin egen. |

Två saker är viktigast att komma ihåg: **ett förlorat lösenord kan bara återställas med återställningsnyckeln**, och **återställningsnyckeln måste förvaras säkert och inlåst**.

## Komma igång

Installera programmet först (se installationsguiden). När det startas för första gången väljer du en av två vägar.

### Den första personen: skapa valvet

1. Klicka på **Create a new vault**.
2. Skriv ditt namn och ett lösenord på minst 10 tecken. En kort mening fungerar bra, till exempel `blå orgel spelar på söndag`.
3. Programmet visar din **recovery key** (återställningsnyckel). Skriv ut den och förvara den på ett låst ställe, till exempel i kyrkkansliets kassaskåp. Den visas bara en gång. Kryssa i rutan för att bekräfta och klicka på **Continue**.
4. Lås upp med ditt lösenord.
5. Klicka på **Set up GitHub sync** och följ stegen i fönstret så att de andra medlemmarna kan dela valvet.

### Alla andra: gå med i valvet

1. Klicka på **Join an existing vault**.
2. Skriv ditt namn, ett eget lösenord, förrådets adress och din egen GitHub-token. Adressen får du av en befintlig medlem.
3. Klicka på **Request access**. Programmet visar en säkerhetskod.
4. Läs upp säkerhetskoden för en befintlig medlem, per telefon eller på plats. Medlemmen godkänner dig i fönstret **Members**.
5. Klicka på **Check if I have been approved**. När det står att du är godkänd låser du upp med ditt lösenord.

### Låsa upp och låsa

På låsskärmen väljer du ditt namn i listan (den visas när valvet har flera medlemmar), skriver ditt lösenord och klickar på **Unlock**. Versionsnumret står längst ned.

Lås valvet med knappen **Lock** uppe till höger. Det låser sig också självt efter 5 minuter utan användning, när skärmen låses och när datorn går i viloläge. Låst betyder att inget går att läsa förrän lösenordet har skrivits in igen.

Efter tre felaktiga lösenord i rad låter programmet dig vänta en stund innan nästa försök, och väntetiden ökar för varje misslyckat försök.

## Arbeta med poster

När valvet är öppet filtrerar vänstra kolumnen på typ (**All**, **Logins**, **Cards**, **Door codes**, **Documents**, **Notes**), mittenkolumnen listar posterna och högra sidan visar den valda posten.

### Lägga till en post

1. Klicka på **+ New** och välj typ.
2. Fyll i **Title** (rubrik) och fälten. Hemliga fält (lösenord, kortnummer, koder) är dolda medan du skriver. Klicka på **Show** för att kontrollera det du skrev.
3. Lägg om du vill till anteckningar och **taggar** avskilda med kommatecken, och kryssa i **Favorite** (favorit). Favoriter listas först.
4. Klicka på **Save**.

### Läsa, kopiera, ändra och ta bort

- Klicka på en post i listan för att se den. Hemliga värden visas som punkter. Klicka på **Show** för att visa ett värde. Det döljs igen efter 20 sekunder.
- Klicka på **Copy** för att lägga ett värde i urklipp. Programmet tömmer urklipp efter 30 sekunder, och när valvet låses, om det fortfarande innehåller det du kopierade.
- Klicka på **Edit** för att ändra en post, eller på **Delete** för att ta bort den. Du får bekräfta borttagningen.

### Sök

Skriv i rutan **Search** högst upp. Sökningen hittar ord i rubriker, taggar, anteckningar, webbadresser, användarnamn, platser, kortinnehavarnamn och filnamn. Flera ord måste alla stämma, och det räcker med början av ett ord. Stora och små bokstäver och accenter spelar ingen roll.

Sökningen tittar aldrig i lösenord, kortnummer, säkerhetskoder, PIN-koder eller dörrkoder, så du kan inte hitta en post genom dess hemlighet.

### Lösenordsgenerator

När du lägger till eller ändrar en inloggning klickar du på **Generate** bredvid lösenordet. Välj en längd mellan 8 och 64 tecken och vilka sorters tecken som ska användas (små bokstäver, stora bokstäver, siffror, symboler). **No look-alikes** utesluter tecken som liknar varandra, till exempel 0 och O eller 1 och l. Klicka på **Regenerate** för ett nytt förslag och sedan på **Use this** för att lägga in det i posten. Längre är starkare. 20 tecken eller fler är en bra vana.

## Dokument och bilagor

Varje post kan ha filer, till exempel skannade fastighetsbrev, försäkringsbrev eller avtal. Typen **Documents** är avsedd för poster som mest består av filer.

### Lägga till filer

1. Öppna eller skapa en post och klicka på **Add files…** i formuläret.
2. Välj en eller flera filer i fönstret som öppnas. Varje fil får vara högst 25 MB, och en post kan innehålla upp till 20 filer.
3. Klicka på **Save**. Filer som du har lagt till men inte sparat kasseras när valvet låses.

Bilagor kan inte byta namn i den här versionen. Vill du ändra ett namn klickar du på **Remove** bredvid filen och lägger sedan till filen igen under det nya namnet.

### Använda filer

Öppna posten och använd knapparna bredvid varje fil:

| Knapp | Vad den gör |
| --- | --- |
| Preview | Visar bilder (PNG, JPEG, GIF, WebP) och rena textfiler inne i programmet. |
| Open | Öppnar filen i ditt vanliga program, till exempel en PDF-läsare. Programmet gör en tillfällig läsbar kopia som tas bort när valvet låses eller programmet stängs. Bara dokument och bilder kan öppnas på det här sättet. |
| Save a copy… | Sparar en läsbar kopia där du väljer. Använd den för filtyper som Open nekar. |

En läsbar kopia utanför ChurchVault är inte längre skyddad. Radera sparade kopior när du är klar med dem.

Om en fil visas som saknad på en ny dator har den förmodligen inte hunnit synkroniseras. Klicka på **Sync now** och försök igen.

## Synkronisera med GitHub

Synkroniseringen håller alla medlemmars datorer uppdaterade. Dina ändringar sparas direkt på din dator och laddas upp när du är uppkopplad.

Programmet synkroniserar av sig självt när du låser upp, några sekunder efter varje ändring och var femte minut. Den övre raden visar när det senast skedde. Klicka på **Sync now** för att synkronisera direkt. Du kan arbeta utan internet. Ändringarna laddas upp senare.

Om något är fel visar den övre raden ett kort meddelande i stället för tiden:

- **GitHub rejected the access token** (GitHub avvisade åtkomsttoken): din token har gått ut eller tagits bort. Klicka på **Update token**, skapa en ny token och klistra in den. Den gamla behålls om den nya inte fungerar.
- **Cannot reach GitHub (offline?)** (GitHub kan inte nås): kontrollera din internetanslutning. Inget går förlorat.

**Disconnect** stoppar synkroniseringen på den här datorn. Dina poster finns kvar på datorn och på GitHub.

### När två personer ändrar samma post

Om två personer ändrar samma post innan deras datorer hunnit synkroniseras går ingenting förlorat. Den version som sparades till GitHub först blir kvar som posten. Den andra versionen behålls som en separat post med samma rubrik och en röd etikett **⚠ Conflict**.

Så här löser du det:

1. Öppna posten som är märkt **⚠ Conflict**. En ruta förklarar vad som hänt.
2. Jämför den med den andra posten med samma namn.
3. Klicka på **Use this version** för att ersätta originalet med den här versionen, eller på **Discard this version** för att ta bort den.

Om en person tar bort en post medan en annan ändrar den vinner ändringen, och posten blir kvar.

## Hantera medlemmar

Klicka på **Members** i den övre raden. Varje medlem kan göra allt i det här fönstret.

### Lägga till en ny medlem

1. Den nya personen installerar programmet och väljer **Join an existing vault** (se Komma igång).
2. Någon med administratörsrättigheter på GitHub bjuder in personen till församlingens GitHub-organisation och ger skrivrättigheter till valvets förråd. Installationsguiden förklarar hur.
3. Efter en stund, eller efter **Sync now**, visas den nya personen i **Members** som *waiting for approval* (väntar på godkännande), med en säkerhetskod.
4. Jämför koden med den som står på den nya personens skärm, per telefon eller på plats, aldrig i e-post eller sms. Den måste stämma exakt. Om den inte gör det ska du inte godkänna.
5. Klicka på **Approve**.

Vill du avvisa en förfrågan klickar du på **Decline**. Då tas den bort och inget annat ändras.

### Ta bort en medlem

1. Klicka på **Remove** bredvid namnet och bekräfta.
2. Programmet byter valvets krypteringsnyckel, så att den som tagits bort inte kan läsa något nytt. Det visar en **ny återställningsnyckel**. Skriv ut den, förvara den säkert och förstör den gamla utskriften, eftersom den gamla nyckeln inte längre fungerar.
3. Ta bort personen ur församlingens GitHub-organisation.
4. Byt de viktiga lösenorden, korten och dörrkoderna som personen kände till. Programmet kan inte få någon att glömma det den redan har sett.

Gör det när ingen annan redigerar. En ändring som sparas på en annan dator i exakt samma ögonblick kan bli oläsbar.

### Ditt eget lösenord

- **Byta det:** i **Members**, under *Change my password*, skriver du det gamla och det nya lösenordet.
- **Glömt det:** klicka på **Forgot password?** på låsskärmen, välj ditt namn, skriv den utskrivna återställningsnyckeln och välj ett nytt lösenord. Dina poster påverkas inte.
- **Förlorat återställningsnyckeln också:** en annan medlem kan ta bort dig och bjuda in dig igen, men du kan inte ta dig in på egen hand.

### En varning bredvid ett namn

Om en medlem visas med **⚠ could not be verified** (kunde inte verifieras) har personens post ändrats av någon som inte har åtkomst till valvet. Godkänn den inte och lita inte på den. Ta bort medlemmen och bjud in personen igen, och be en annan medlem titta på GitHub-förrådet.

## Säkerhetsråd och begränsningar

Programmet skyddar posterna väl, men dina vanor är minst lika viktiga som programvaran.

### Bra vanor

- Använd ett starkt, unikt lösenord till ChurchVault och slå på tvåfaktorsautentisering på varje medlems GitHub-konto.
- Förvara den utskrivna återställningsnyckeln inlåst, och se till att minst två medlemmar vet var den finns.
- Lås programmet, eller datorn, när du går ifrån den.
- Installera ChurchVault bara på dina egna datorer, aldrig på delade eller offentliga.
- Kopiera ett lösenord bara när du behöver det. Klistra inte in hemligheter i e-post eller chatt.
- Håll valvets förråd på GitHub **privat**.
- När någon slutar: följ stegen under Ta bort en medlem och byt de hemligheter personen kände till.

### Vad GitHub och andra kan se

Allt du skriver in i en post är krypterat: rubriker, lösenord, kortuppgifter, koder, anteckningar, taggar, filnamn och filinnehåll. Den som kommer över förrådet, eller filerna på en stulen dator, ser bara oläsliga data.

Viss information är **inte** dold:

- **Medlemmarnas namn** lagras läsbart, både i varje medlems post och som författare till varje ändring i GitHubs historik.
- Hur många poster och filer som finns, ungefär hur stora de är och när de ändrades.
- Vilka GitHub-konton som har åtkomst till förrådet.

Dessa uppgifter ger inte tillgång till någon hemlighet. Om det är ett problem för er församling kan ni berätta det för den som ansvarar för programmet. Att dölja namnen är möjligt men har inte byggts ännu.

### Vad programmet inte kan göra

- Det kan inte återställa ett förlorat lösenord utan återställningsnyckeln.
- Det kan inte skydda en dator som redan har ett virus eller styrs av en obehörig.
- Det kan inte ta tillbaka det en tidigare medlem redan har sett eller kopierat.
- En avkrypterad kopia som du sparar eller öppnar utanför programmet är inte längre skyddad.
- Programmet är inte signerat av Apple eller Microsoft, och därför varnar din dator första gången du öppnar det.

## Felsökning och vanliga frågor

| Problem | Vad du gör |
| --- | --- |
| "Wrong password" (fel lösenord) | Kontrollera tangentbordslayout och Caps Lock. Efter flera misslyckade försök låter programmet dig vänta innan du får försöka igen. |
| Jag har glömt mitt lösenord | Klicka på **Forgot password?** på låsskärmen och använd den utskrivna återställningsnyckeln. |
| Jag har förlorat både återställningsnyckeln och lösenordet | Be en annan medlem ta bort dig och bjuda in dig igen. |
| "Refusing to unlock …" (nekar att låsa upp) | Programmet upptäckte att någon har manipulerat valvets filer på GitHub. Fortsätt inte försöka. Be en annan medlem kontrollera förrådets historik på GitHub. |
| Den övre raden visar ett synkroniseringsfel | Läs meddelandet. Tokenproblem: klicka på **Update token**. Offline: vänta tills anslutningen kommer tillbaka. Annars klickar du på **Sync now**. |
| En fil saknas | Den har inte synkroniserats till den här datorn än. Klicka på **Sync now** och försök igen. |
| Den nya medlemmen syns inte i Members | Personen måste ha klickat på **Request access**, och du kan behöva klicka på **Sync now**. Personen måste också vara inbjuden på GitHub. |
| Vissa poster "could not be read" (kunde inte läsas) efter upplåsning | Valvets nyckel byttes av en annan medlem. Klicka på **Sync now**, lås och lås upp igen. Om det kvarstår kan du fråga den som tog bort en medlem om bytet blev klart. |
| En post har etiketten **⚠ Conflict** | Två personer ändrade den samtidigt. Se "När två personer ändrar samma post" ovan. |
| Fönstret ser fel ut eller är tomt | Stäng programmet helt och starta det igen. Dina data påverkas inte. |

### Uppdateringar

På Windows laddas nya versioner ned i bakgrunden. En rad högst upp visar **Restart and update** när en är klar. Valvet låses när du klickar på den.

På Mac berättar en rad högst upp att det finns en ny version. Klicka på **Download** och installera den på samma sätt som den första. Ditt valv påverkas inte.

### Var finns mina data?

Posterna finns som krypterade filer på din dator och i det privata GitHub-förrådet. Om du avinstallerar programmet tas din lokala kopia inte bort. För att ta bort en dator från valvet tar du bort dess medlem i **Members** och raderar sedan programmets datamapp.

### Få hjälp

Om något går fel som inte står här: skriv ned meddelandet du ser och vad du gjorde precis innan, och skicka det till den som ansvarar för programmet. Skicka aldrig lösenord eller återställningsnyckeln.
