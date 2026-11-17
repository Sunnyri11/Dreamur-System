namespace DreamurDetector.Infrastructure.Services;

/// <summary>Listado de médicos para el administrador. (El alta y activar/desactivar van por IUsuarioService.)</summary>
public sealed class MedicoService(AppDbContext db) : IMedicoService
{
    public async Task<PagedResult<MedicoDto>> ListarAsync(MedicoFiltro f, CancellationToken ct)
    {
        var q = db.Medicos.AsNoTracking()
            .Where(m => m.Persona.DeletedAt == null && m.Persona.Usuario != null);

        if (!string.IsNullOrWhiteSpace(f.Buscar))
        {
            var patron = DbExtensions.PatronILike(f.Buscar);
            q = q.Where(m =>
                EF.Functions.ILike(m.Persona.Nombres + " " + m.Persona.Apellidos, patron) ||
                (m.Matricula != null && EF.Functions.ILike(m.Matricula, patron)) ||
                m.Persona.Correos.Any(c => EF.Functions.ILike(c.Correo, patron)));
        }

        return await q
            .OrderBy(m => m.Persona.Apellidos).ThenBy(m => m.Persona.Nombres)
            .Select(m => new MedicoDto(
                m.Persona.Usuario!.Id,
                m.PersonaId,
                m.Persona.Nombres,
                m.Persona.Apellidos,
                m.Persona.Correos.Where(c => c.EsPrincipal).Select(c => c.Correo).FirstOrDefault(),
                m.Matricula,
                m.Especialidad,
                m.Persona.Usuario!.Activo,
                m.Persona.Usuario!.UltimoAcceso,
                db.MedicoPacientes.Count(mp => mp.MedicoId == m.PersonaId),
                m.Persona.Usuario!.CreatedAt))
            .PaginarAsync(f.Pagina, f.TamanoPagina, ct);
    }
}
