FROM ://microsoft.com
WORKDIR /app
COPY . .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "DreamurDetector.Api.dll"]
