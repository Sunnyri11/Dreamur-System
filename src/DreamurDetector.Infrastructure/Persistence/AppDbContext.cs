using System.Text.RegularExpressions;

namespace DreamurDetector.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Persona> Personas => Set<Persona>();
    public DbSet<CorreoElectronico> Correos => Set<CorreoElectronico>();
    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<TokenVerificacion> TokensVerificacion => Set<TokenVerificacion>();
    public DbSet<TokenRevocado> TokensRevocados => Set<TokenRevocado>();
    public DbSet<Paciente> Pacientes => Set<Paciente>();
    public DbSet<Medico> Medicos => Set<Medico>();
    public DbSet<Administrador> Administradores => Set<Administrador>();
    public DbSet<Consentimiento> Consentimientos => Set<Consentimiento>();
    public DbSet<TipoTumor> TiposTumor => Set<TipoTumor>();
    public DbSet<Radiografia> Radiografias => Set<Radiografia>();
    public DbSet<RadiografiaArchivo> RadiografiaArchivos => Set<RadiografiaArchivo>();
    public DbSet<ModeloVersion> ModeloVersiones => Set<ModeloVersion>();
    public DbSet<Entrenamiento> Entrenamientos => Set<Entrenamiento>();
    public DbSet<Deteccion> Detecciones => Set<Deteccion>();
    public DbSet<DeteccionZona> DeteccionesZonas => Set<DeteccionZona>();
    public DbSet<Etiqueta> Etiquetas => Set<Etiqueta>();
    public DbSet<Auditoria> Auditoria => Set<Auditoria>();
    public DbSet<MedicoPaciente> MedicoPacientes => Set<MedicoPaciente>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        mb.Entity<Persona>(e =>
        {
            e.ToTable("personas");
            e.HasKey(x => x.Id);
            e.HasMany(x => x.Correos).WithOne(c => c.Persona).HasForeignKey(c => c.PersonaId);
            e.HasOne(x => x.Usuario).WithOne(u => u.Persona).HasForeignKey<Usuario>(u => u.PersonaId);
            e.HasOne(x => x.Paciente).WithOne(p => p.Persona).HasForeignKey<Paciente>(p => p.PersonaId);
            e.HasOne(x => x.Medico).WithOne(p => p.Persona).HasForeignKey<Medico>(p => p.PersonaId);
            e.HasOne(x => x.Administrador).WithOne(p => p.Persona).HasForeignKey<Administrador>(p => p.PersonaId);
        });

        mb.Entity<CorreoElectronico>(e =>
        {
            e.ToTable("correos_electronicos");
            e.HasKey(x => x.Id);
            e.Property(x => x.Correo).HasColumnType("citext");
            e.Property(x => x.UsuarioId);
        });

        mb.Entity<Usuario>(e =>
        {
            e.ToTable("usuarios");
            e.HasKey(x => x.Id);
        });

        mb.Entity<TokenVerificacion>(e =>
        {
            e.ToTable("tokens_verificacion");
            e.HasKey(x => x.Id);
            e.HasOne<Usuario>().WithMany().HasForeignKey(x => x.UsuarioId);
        });

        mb.Entity<TokenRevocado>(e =>
        {
            e.ToTable("tokens_revocados");
            e.HasKey(x => x.Jti);
        });

        mb.Entity<Paciente>(e =>
        {
            e.ToTable("pacientes");
            e.HasKey(x => x.PersonaId);
            e.Property(x => x.PersonaId).ValueGeneratedNever();
            e.Property(x => x.Codigo)
                .HasDefaultValueSql("('PAC-' || lpad(nextval('seq_codigo_paciente')::text, 6, '0'))")
                .ValueGeneratedOnAdd();
        });

        mb.Entity<Medico>(e =>
        {
            e.ToTable("medicos");
            e.HasKey(x => x.PersonaId);
            e.Property(x => x.PersonaId).ValueGeneratedNever();
        });

        mb.Entity<Administrador>(e =>
        {
            e.ToTable("administradores");
            e.HasKey(x => x.PersonaId);
            e.Property(x => x.PersonaId).ValueGeneratedNever();
        });

        mb.Entity<Consentimiento>(e =>
        {
            e.ToTable("consentimientos");
            e.HasKey(x => x.Id);
            e.HasOne<Paciente>().WithMany().HasForeignKey(x => x.PacienteId);
        });

        mb.Entity<TipoTumor>(e =>
        {
            e.ToTable("tipos_tumor");
            e.HasKey(x => x.Codigo);
        });

        mb.Entity<Radiografia>(e =>
        {
            e.ToTable("estudios");
            e.HasKey(x => x.Id);
            e.HasOne(x => x.Paciente).WithMany().HasForeignKey(x => x.PacienteId).IsRequired(false);
            e.HasOne(x => x.Archivo).WithOne(a => a.Radiografia).HasForeignKey<RadiografiaArchivo>(a => a.RadiografiaId);
            e.HasOne(x => x.Etiqueta).WithOne(t => t.Radiografia).HasForeignKey<Etiqueta>(t => t.RadiografiaId);
            e.HasMany(x => x.Detecciones).WithOne(d => d.Radiografia).HasForeignKey(d => d.RadiografiaId);
        });

        mb.Entity<RadiografiaArchivo>(e =>
        {
            e.ToTable("estudio_archivos");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
        });

        mb.Entity<ModeloVersion>(e =>
        {
            e.ToTable("modelo_versiones");
            e.HasKey(x => x.Id);
            e.Property(x => x.Heads).HasColumnType("jsonb");
            e.Property(x => x.PesosXgb).HasColumnType("jsonb");
            e.Property(x => x.Metricas).HasColumnType("jsonb");
        });

        mb.Entity<Entrenamiento>(e =>
        {
            e.ToTable("entrenamientos");
            e.HasKey(x => x.Id);
        });

        mb.Entity<Deteccion>(e =>
        {
            e.ToTable("detecciones");
            e.HasKey(x => x.Id);
            e.Property(x => x.Probabilidades).HasColumnType("jsonb");
            e.HasMany(x => x.Zonas).WithOne().HasForeignKey(z => z.DeteccionId);
        });

        mb.Entity<DeteccionZona>(e =>
        {
            e.ToTable("detecciones_zonas");
            e.HasKey(x => x.Id);
        });

        mb.Entity<Etiqueta>(e =>
        {
            e.ToTable("etiquetas");
            e.HasKey(x => x.RadiografiaId);
            e.Property(x => x.RadiografiaId).ValueGeneratedNever();
        });

        mb.Entity<MedicoPaciente>(e =>
        {
            e.ToTable("medico_pacientes");
            e.HasKey(x => new { x.MedicoId, x.PacienteId });
            // Declarar las FK le da a EF el orden de inserción correcto (médico/paciente antes del vínculo).
            e.HasOne<Medico>().WithMany().HasForeignKey(x => x.MedicoId);
            e.HasOne<Paciente>().WithMany().HasForeignKey(x => x.PacienteId);
        });

        mb.Entity<Auditoria>(e =>
        {
            e.ToTable("auditoria");
            e.HasKey(x => x.Id);
            e.Property(x => x.Detalle).HasColumnType("jsonb");
        });

        // Convención: PropiedadCSharp -> columna_snake_case (coincide con schema.sql).
        foreach (var entity in mb.Model.GetEntityTypes())
            foreach (var prop in entity.GetProperties())
                prop.SetColumnName(ToSnake(prop.Name));

        // Excepciones: el esquema real de Neon llama "estudio" a lo que el código llama "radiografía".
        mb.Entity<RadiografiaArchivo>().Property(x => x.RadiografiaId).HasColumnName("estudio_id");
        mb.Entity<Deteccion>().Property(x => x.RadiografiaId).HasColumnName("estudio_id");
        mb.Entity<Etiqueta>().Property(x => x.RadiografiaId).HasColumnName("estudio_id");
    }

    private static readonly Regex SnakeRegex =
        new("(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", RegexOptions.Compiled);

    private static string ToSnake(string name) => SnakeRegex.Replace(name, "_").ToLowerInvariant();
}
