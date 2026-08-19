-- 0110_ticket_resend_template.sql
-- Slaat de globale default template voor "tickets opnieuw versturen" op.
-- Placeholder-syntax: {{koper_naam}}, {{concert_titel}}, {{concert_datum}},
-- {{concert_tijd}}, {{concert_locatie}}, {{order_ref}}, {{tickets_summary}},
-- {{totaal_bedrag}}, {{member_portal_url}}
--
-- Aparte kolommen: subject + html. Zit in system_settings zodat admins het
-- via UI kunnen bewerken zonder deploy.
--
-- (Als 'system_settings' al bestaat: no-op via INSERT OR IGNORE.)

INSERT OR IGNORE INTO system_settings (key, value, updated_at)
VALUES (
  'ticket_resend_template_subject',
  'Herinnering: je tickets voor {{concert_titel}} — {{order_ref}}',
  CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_settings (key, value, updated_at)
VALUES (
  'ticket_resend_template_html',
  '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #6A0DAD 0%, #8B5CF6 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">Je tickets — nogmaals toegestuurd</h1>
    <p style="margin: 10px 0 0 0; opacity: 0.9;">Gemengd Koor Animato</p>
  </div>
  <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
    <p>Beste {{koper_naam}},</p>
    <p>Op je verzoek (of ter herinnering) sturen we je de tickets voor <strong>{{concert_titel}}</strong> nogmaals toe.</p>
    <div style="background: #f9fafb; padding: 16px; border-radius: 6px; border-left: 4px solid #8B5CF6; margin: 16px 0;">
      <p style="margin: 0 0 8px 0;"><strong>📅 Datum:</strong> {{concert_datum}}</p>
      <p style="margin: 0 0 8px 0;"><strong>🕐 Aanvang:</strong> {{concert_tijd}}</p>
      <p style="margin: 0 0 8px 0;"><strong>📍 Locatie:</strong> {{concert_locatie}}</p>
      <p style="margin: 0 0 8px 0;"><strong>🎫 Bestelling:</strong> {{order_ref}}</p>
      <p style="margin: 0;"><strong>Tickets:</strong> {{tickets_summary}}</p>
    </div>
    <p>Je vindt je ticket(s) als PDF in bijlage (indien we die meesturen). Toon de QR-code aan de ingang.</p>
    <p>Tot binnenkort!</p>
    <p style="margin-top: 24px;">
      Muzikale groeten,<br>
      <strong>Gemengd Koor Animato</strong>
    </p>
  </div>
  <div style="text-align: center; color: #6b7280; font-size: 12px; padding: 16px;">
    <p>Bij vragen: <a href="mailto:info@gemengdkooranimato.be">info@gemengdkooranimato.be</a></p>
    <p>Gemengd Koor Animato | www.gemengdkooranimato.be</p>
  </div>
</div>',
  CURRENT_TIMESTAMP
);
