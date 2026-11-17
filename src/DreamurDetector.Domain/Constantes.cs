namespace DreamurDetector.Domain;

public static class Roles
{
    public const string Paciente = "paciente";
    public const string Medico = "medico";
    public const string Admin = "admin";

    /// <summary>Lista separada por comas para [Authorize(Roles = ...)] (OR).</summary>
    public const string Staff = "medico,admin";
}

public static class Regiones
{
    public const string Cerebro = "cerebro";
}

public static class Modalidades
{
    public const string MriCerebro = "mri";
    public const string TcCerebro = "tc";
    public static readonly string[] Cerebro = [MriCerebro, TcCerebro];
}

public static class Origenes
{
    public const string Paciente = "paciente";
    public const string Personal = "personal";
    public const string Dataset = "dataset";
}

public static class EstadosRadiografia
{
    public const string Subida = "subido";
    public const string Analizada = "analizado";
    public const string Revisada = "revisado";
}

public static class TiposToken
{
    public const string VerificarCorreo = "verificar_correo";
    public const string RestablecerPassword = "restablecer_password";
}

public static class TiposConsentimiento
{
    public const string TratamientoDatos = "tratamiento_datos";
    public const string UsoEntrenamiento = "uso_entrenamiento";
}

public static class FuentesEtiqueta
{
    public const string DatasetInicial = "dataset_inicial";
    public const string RevisionMedica = "revision_medica";
}

public static class EstadosEntrenamiento
{
    public const string EnCurso = "en_curso";
    public const string Completado = "completado";
    public const string Error = "error";
}

public static class CodigosTumor
{
    public const string SinTumor = "sin_tumor";
}
